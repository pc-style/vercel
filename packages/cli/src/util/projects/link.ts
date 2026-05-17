import fs from 'fs';
import AJV from 'ajv';
import { join, relative } from 'path';
import { ensureDir } from 'fs-extra';
import { promisify } from 'util';

import getProjectByIdOrName from '../projects/get-project-by-id-or-name';
import type Client from '../client';
import { InvalidToken, isAPIError, ProjectNotFound } from '../errors-ts';
import getUser from '../get-user';
import getTeamById from '../teams/get-team-by-id';
import type {
  Project,
  ProjectLinkResult,
  Org,
  ProjectLink,
} from '@vercel-internals/types';
import { prependEmoji, emoji, type EmojiLabel } from '../emoji';
import { isDirectory } from '../fs';
import { NowBuildError, getPlatformEnv } from '@vercel/build-utils';
import outputCode from '../output/code';
import { isErrnoException, isError } from '@vercel/error-utils';
import { findProjectsFromPath, getRepoLink } from '../link/repo';
import { addToGitIgnore } from '../link/add-to-gitignore';
import type { RepoProjectConfig } from '../link/repo';
import output from '../../output-manager';
import { printAlignedLabel } from '../output/print-aligned-label';
import pull from '../../commands/env/pull';
import { resolveProjectCwd } from './find-project-root';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

export const VERCEL_DIR = '.vercel';
export const VERCEL_DIR_FALLBACK = '.now';
export const VERCEL_DIR_README = 'README.txt';
export const VERCEL_DIR_PROJECT = 'project.json';
export const VERCEL_DIR_REPO = 'repo.json';

const linkSchema = {
  type: 'object',
  required: ['projectId', 'orgId'],
  properties: {
    projectId: {
      type: 'string',
      minLength: 1,
    },
    orgId: {
      type: 'string',
      minLength: 1,
    },
    projectName: {
      type: 'string',
      minLength: 1,
    },
  },
};

export const DEFAULT_PROJECT_LINK_NAME = 'default';

export type ProjectLinkFile = Partial<ProjectLink> & {
  projects?: Record<string, ProjectLink>;
  settings?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProjectLink(value: unknown): value is ProjectLink {
  return (
    isRecord(value) &&
    typeof value.projectId === 'string' &&
    value.projectId.length > 0 &&
    typeof value.orgId === 'string' &&
    value.orgId.length > 0
  );
}

// Parses global flags used to select a named local project link. `--project` is
// kept for backwards compatibility, but skipped for `vc link` because that
// command defines `--project` as a Vercel project name or ID.
function getProjectLinkNameFromArgs(argv: string[]): string | undefined {
  const allowLegacyProjectFlag = argv[2] !== 'link';
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-link') {
      return argv[i + 1];
    }
    if (arg.startsWith('--project-link=')) {
      return arg.slice('--project-link='.length);
    }
    if (allowLegacyProjectFlag && arg === '--project') {
      return argv[i + 1];
    }
    if (allowLegacyProjectFlag && arg.startsWith('--project=')) {
      return arg.slice('--project='.length);
    }
  }
}

export function getProjectLinksFromFile(
  link: ProjectLinkFile
): Record<string, ProjectLink> {
  const projects = isRecord(link.projects) ? link.projects : undefined;
  if (projects) {
    const projectLinks: Record<string, ProjectLink> = {};
    for (const [name, project] of Object.entries(projects)) {
      if (isProjectLink(project)) {
        projectLinks[name] = project;
      }
    }
    return projectLinks;
  }
  if (isProjectLink(link)) {
    return { [DEFAULT_PROJECT_LINK_NAME]: link };
  }
  return {};
}

function getSelectedProjectLink(
  link: ProjectLinkFile,
  selectedProjectName?: string
): ProjectLink | null {
  const projects = getProjectLinksFromFile(link);
  const selection = selectedProjectName ?? DEFAULT_PROJECT_LINK_NAME;
  return projects[selection] ?? null;
}

/**
 * Returns the `<cwd>/.vercel` directory for the current project
 * with a fallback to <cwd>/.now` if it exists.
 *
 * Throws an error if *both* `.vercel` and `.now` directories exist.
 */
export function getVercelDirectory(cwd: string): string {
  const possibleDirs = [join(cwd, VERCEL_DIR), join(cwd, VERCEL_DIR_FALLBACK)];
  const existingDirs = possibleDirs.filter(d => isDirectory(d));
  if (existingDirs.length > 1) {
    throw new NowBuildError({
      code: 'CONFLICTING_CONFIG_DIRECTORIES',
      message:
        'Both `.vercel` and `.now` directories exist. Please remove the `.now` directory.',
      link: 'https://vercel.link/combining-old-and-new-config',
    });
  }
  return existingDirs[0] || possibleDirs[0];
}

export async function getProjectLink(
  client: Client,
  path: string,
  projectLinkName?: string,
  projectName?: string
): Promise<ProjectLink | null> {
  // Prefer an explicit per-directory link (`.vercel/project.json`) over a
  // repository-level link (`.vercel/repo.json`). This prevents scenarios where
  // a freshly-created local link (e.g. after `vc link`) is ignored and the
  // user is re-prompted to select a repo-linked project again.
  const selectedProjectLinkName =
    projectLinkName ?? getProjectLinkNameFromArgs(client.argv);
  const dirLink = await getLinkFromDir(
    getVercelDirectory(path),
    selectedProjectLinkName
  );
  if (dirLink) {
    return dirLink;
  }
  return await getProjectLinkFromRepoLink(
    client,
    path,
    projectName ?? selectedProjectLinkName
  );
}

async function getProjectLinkFromRepoLink(
  client: Client,
  path: string,
  projectName?: string
): Promise<ProjectLink | null> {
  const repoLink = await getRepoLink(client, path);
  if (!repoLink?.repoConfig) {
    return null;
  }
  const projects = findProjectsFromPath(
    repoLink.repoConfig.projects,
    relative(repoLink.rootPath, path)
  );
  let project: RepoProjectConfig | undefined;
  if (projects.length === 1) {
    project = projects[0];
  } else {
    const selectableProjects =
      projects.length > 0 ? projects : repoLink.repoConfig.projects;

    // If --project flag was provided, try to find a matching project by name
    if (projectName) {
      project = selectableProjects.find(p => p.name === projectName);
    }

    // Fall back to interactive selection if no project was found
    if (!project) {
      if (client.nonInteractive) {
        if (selectableProjects.length === 1) {
          project = selectableProjects[0];
        } else {
          return null;
        }
      } else {
        project = await client.input.select({
          message: `Please select a Project:`,
          choices: selectableProjects.map(p => ({
            value: p,
            name: p.name,
          })),
        });
      }
    }
  }
  if (project) {
    // Prefer project-level orgId, fall back to top-level for backwards compat
    const orgId = project.orgId ?? repoLink.repoConfig.orgId;
    if (!orgId) {
      const projectInfo = [
        project.name ? `name: "${project.name}"` : '',
        project.directory ? `directory: "${project.directory}"` : '',
      ]
        .filter(Boolean)
        .join(', ');
      const details = projectInfo ? ` Project: { ${projectInfo} }.` : '';
      throw new Error(
        `Could not determine org ID from repo.json config at "${repoLink.repoConfigPath}".${details} Please re-link the repository.`
      );
    }
    return {
      repoRoot: repoLink.rootPath,
      orgId,
      projectId: project.id,
      projectRootDirectory: project.directory,
    };
  }
  return null;
}

export async function getLinkFromDir<T = ProjectLink>(
  dir: string,
  projectName?: string
): Promise<T | null> {
  try {
    const json = await readFile(join(dir, VERCEL_DIR_PROJECT), 'utf8');

    const ajv = new AJV();
    const link = JSON.parse(json) as ProjectLinkFile;
    const selectedLink = getSelectedProjectLink(link, projectName);

    if (!selectedLink) {
      if (projectName && isRecord(link.projects)) {
        throw new Error(
          `Project "${projectName}" is not linked in ${join(
            dir,
            VERCEL_DIR_PROJECT
          )}.`
        );
      }
      return null;
    }

    if (!ajv.validate(linkSchema, selectedLink)) {
      throw new Error(
        `Project Settings are invalid. To link your project again, remove the ${dir} directory.`
      );
    }

    return selectedLink as T;
  } catch (err: unknown) {
    // link file does not exists, project is not linked
    if (
      isErrnoException(err) &&
      err.code &&
      ['ENOENT', 'ENOTDIR'].includes(err.code)
    ) {
      return null;
    }

    // link file can't be read
    if (isError(err) && err.name === 'SyntaxError') {
      throw new Error(
        `Project Settings could not be retrieved. To link your project again, remove the ${dir} directory.`
      );
    }

    throw err;
  }
}

async function getOrgById(client: Client, orgId: string): Promise<Org | null> {
  if (orgId.startsWith('team_')) {
    try {
      const team = await getTeamById(client, orgId);
      if (!team) return null;
      return { type: 'team', id: team.id, slug: team.slug };
    } catch (err) {
      // If the linked team no longer exists (or test mocks intentionally omit
      // this endpoint), treat it as "not linked" instead of hard-failing.
      if (
        isAPIError(err) &&
        (err.status === 404 ||
          err.code === 'not_found' ||
          err.code === 'mock_unimplemented')
      ) {
        return null;
      }
      throw err;
    }
  }

  const user = await getUser(client);
  if (user.id !== orgId) return null;
  return { type: 'user', id: orgId, slug: user.username };
}

async function hasProjectLink(
  client: Client,
  projectLink: ProjectLink,
  path: string,
  projectLinkName: string = DEFAULT_PROJECT_LINK_NAME
): Promise<boolean> {
  // "linked" via env vars?
  const VERCEL_ORG_ID = getPlatformEnv('ORG_ID');
  const VERCEL_PROJECT_ID = getPlatformEnv('PROJECT_ID');
  if (
    VERCEL_ORG_ID === projectLink.orgId &&
    VERCEL_PROJECT_ID === projectLink.projectId
  ) {
    return true;
  }

  // linked via `repo.json`?
  const repoLink = await getRepoLink(client, path);
  if (repoLink?.repoConfig) {
    const matchingProject = repoLink.repoConfig.projects.find(
      p => p.id === projectLink.projectId
    );
    if (matchingProject) {
      // Prefer project-level orgId, fall back to top-level for backwards compat
      const orgId = matchingProject.orgId ?? repoLink.repoConfig.orgId;
      if (!orgId) {
        throw new Error(
          `Invalid "repo.json": missing "orgId" for project "${matchingProject.id}" and no top-level "orgId" is defined.`
        );
      }
      if (orgId === projectLink.orgId) {
        return true;
      }
    }
  }

  // if the project is already linked, we skip linking
  const link = await getLinkFromDir(getVercelDirectory(path), projectLinkName);
  if (
    link &&
    link.orgId === projectLink.orgId &&
    link.projectId === projectLink.projectId
  ) {
    return true;
  }

  return false;
}

export async function getLinkedProject(
  client: Client,
  path = client.cwd,
  projectName?: string,
  projectLinkName?: string
): Promise<ProjectLinkResult> {
  path = await resolveProjectCwd(path);

  const VERCEL_ORG_ID = getPlatformEnv('ORG_ID');
  const VERCEL_PROJECT_ID = getPlatformEnv('PROJECT_ID');
  const shouldUseEnv = Boolean(VERCEL_ORG_ID && VERCEL_PROJECT_ID);

  if ((VERCEL_ORG_ID || VERCEL_PROJECT_ID) && !shouldUseEnv) {
    output.error(
      `You specified ${
        VERCEL_ORG_ID ? '`VERCEL_ORG_ID`' : '`VERCEL_PROJECT_ID`'
      } but you forgot to specify ${
        VERCEL_ORG_ID ? '`VERCEL_PROJECT_ID`' : '`VERCEL_ORG_ID`'
      }. You need to specify both to deploy to a custom project.\n`
    );
    return { status: 'error', exitCode: 1 };
  }

  const link =
    VERCEL_ORG_ID && VERCEL_PROJECT_ID
      ? { orgId: VERCEL_ORG_ID, projectId: VERCEL_PROJECT_ID }
      : await getProjectLink(client, path, projectLinkName, projectName);

  if (!link) {
    return { status: 'not_linked', org: null, project: null };
  }

  output.spinner('Retrieving project…', 1000);
  let org: Org | null = null;
  let project: Project | ProjectNotFound | null = null;
  try {
    const [orgResult, projectResult] = await Promise.allSettled([
      getOrgById(client, link.orgId),
      getProjectByIdOrName(client, link.projectId, link.orgId),
    ]);

    if (orgResult.status === 'fulfilled') {
      org = orgResult.value;
    } else if (
      isAPIError(orgResult.reason) &&
      (orgResult.reason.status === 404 ||
        orgResult.reason.code === 'not_found' ||
        orgResult.reason.code === 'mock_unimplemented')
    ) {
      org = null;
    } else {
      throw orgResult.reason;
    }

    if (projectResult.status === 'fulfilled') {
      project = projectResult.value;
    } else if (
      isAPIError(projectResult.reason) &&
      (projectResult.reason.status === 404 ||
        projectResult.reason.code === 'not_found' ||
        projectResult.reason.code === 'mock_unimplemented')
    ) {
      project = new ProjectNotFound(link.projectId);
    } else {
      throw projectResult.reason;
    }
  } catch (err: unknown) {
    if (isAPIError(err) && err.status === 403) {
      output.stopSpinner();

      if (err.missingToken || err.invalidToken) {
        throw new InvalidToken(client.authConfig.tokenSource);
      } else if (err.code === 'forbidden' || err.code === 'team_unauthorized') {
        throw new NowBuildError({
          message: `Could not retrieve Project Settings. To link your Project, remove the ${outputCode(
            VERCEL_DIR
          )} directory and deploy again.`,
          code: 'PROJECT_UNAUTHORIZED',
          link: 'https://vercel.link/cannot-load-project-settings',
        });
      }
    }

    // Not a special case 403, we should still throw it
    throw err;
  } finally {
    output.stopSpinner();
  }

  if (!org || !project || project instanceof ProjectNotFound) {
    if (shouldUseEnv) {
      output.error(
        `Project not found (${JSON.stringify({
          VERCEL_PROJECT_ID,
          VERCEL_ORG_ID,
        })})\n`
      );
      return { status: 'error', exitCode: 1 };
    }

    output.print(
      prependEmoji(
        'Your Project was either deleted, transferred to a new Team, or you don’t have access to it anymore.\n',
        emoji('warning')
      )
    );
    return { status: 'not_linked', org: null, project: null };
  }

  return { status: 'linked', org, project, repoRoot: link.repoRoot };
}

const VERCEL_DIR_README_CONTENT = `> Why do I have a folder named ".vercel" in my project?
The ".vercel" folder is created when you link a directory to a Vercel project.

> What does the "project.json" file contain?
The "project.json" file contains:
- The ID of the Vercel project that you linked ("projectId")
- The ID of the user or team your Vercel project is owned by ("orgId")

> Should I commit the ".vercel" folder?
No, you should not share the ".vercel" folder with anyone.
Upon creation, it will be automatically added to your ".gitignore" file.
`;

export async function writeReadme(path: string) {
  await writeFile(
    join(path, VERCEL_DIR, VERCEL_DIR_README),
    VERCEL_DIR_README_CONTENT
  );
}

export async function readProjectLinkFile(
  dir: string
): Promise<ProjectLinkFile> {
  try {
    return JSON.parse(
      await readFile(join(dir, VERCEL_DIR_PROJECT), 'utf8')
    ) as ProjectLinkFile;
  } catch (err: unknown) {
    if (
      isErrnoException(err) &&
      err.code &&
      ['ENOENT', 'ENOTDIR'].includes(err.code)
    ) {
      return {};
    }

    if (isError(err) && err.name === 'SyntaxError') {
      return {};
    }

    throw err;
  }
}

export async function writeProjectLinkFile(
  path: string,
  projectLink: ProjectLink,
  projectName: string,
  projectLinkName: string = DEFAULT_PROJECT_LINK_NAME
) {
  const dir = join(path, VERCEL_DIR);
  await ensureDir(dir);
  const existingLink = await readProjectLinkFile(dir);
  const projects = getProjectLinksFromFile(existingLink);
  projects[projectLinkName] = {
    orgId: projectLink.orgId,
    projectId: projectLink.projectId,
    projectName,
  };

  const nextLink: ProjectLinkFile = { projects };
  if (typeof existingLink.settings !== 'undefined') {
    nextLink.settings = existingLink.settings;
  }

  await writeFile(
    join(dir, VERCEL_DIR_PROJECT),
    JSON.stringify(nextLink, null, 2)
  );
}

export async function linkFolderToProject(
  client: Client,
  path: string,
  projectLink: ProjectLink,
  projectName: string,
  orgSlug: string,
  successEmoji: EmojiLabel = 'link',
  autoConfirm: boolean = false,
  pullEnv: boolean = true,
  projectLinkName: string = DEFAULT_PROJECT_LINK_NAME
) {
  // if the project is already linked, we skip linking
  if (await hasProjectLink(client, projectLink, path, projectLinkName)) {
    return;
  }

  try {
    await ensureDir(join(path, VERCEL_DIR));
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === 'ENOTDIR') {
      // folder couldn't be created because
      // we're deploying a static file
      return;
    }
    throw err;
  }

  await writeProjectLinkFile(path, projectLink, projectName, projectLinkName);

  await writeReadme(path);

  // update .gitignore (silent — git status surfaces the change on demand)
  await addToGitIgnore(path);

  printAlignedLabel('Linked', `${orgSlug}/${projectName}`);

  if (!pullEnv) {
    return;
  }

  // Skip env pull prompt in CI/non-TTY and in `--non-interactive` (agents, scripts).
  if (!client.stdin.isTTY || client.nonInteractive) {
    return;
  }

  const pullEnvConfirmed =
    autoConfirm ||
    (await client.input.confirm(
      'Would you like to pull environment variables now?',
      true
    ));

  if (pullEnvConfirmed) {
    const originalCwd = client.cwd;
    try {
      client.cwd = path;

      const args = autoConfirm ? ['--yes'] : [];
      const exitCode = await pull(client, args, 'vercel-cli:link');

      if (exitCode !== 0) {
        output.error(
          'Failed to pull environment variables. You can run `vc env pull` manually.'
        );
      }
    } catch (_error) {
      output.error(
        'Failed to pull environment variables. You can run `vc env pull` manually.'
      );
    } finally {
      client.cwd = originalCwd;
    }
  }
}
