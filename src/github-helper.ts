import * as github from '@actions/github'
import * as core from '@actions/core'
import * as utils from './utils'
import * as _ from 'lodash'

const ERROR_PR_REVIEW_FROM_AUTHOR =
  'Review cannot be requested from pull request author'

export type Label = {
  color: string
  default: boolean
  description: string
  id: number
  name: string
  node_id: string
  url: string
}
export interface Inputs {
  token: string
  committer: string
  author: string
  branch: string
  labels: string[]
  assignees: string[]
  reviewers: string[]
  teamReviewers: string[]
  allowUserToSpecifyBranchViaLabel: string
  labelPatternRequirement: string
  userBranchPrefix: string
  titleWithTargetBranch: string
}

export async function createPullRequest(
  inputs: Inputs,
  prBranch: string,
  branch: string
): Promise<void> {
  const octokit = github.getOctokit(inputs.token)
  if (process.env.GITHUB_REPOSITORY !== undefined) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

    // Get PR title
    let title =
      github.context.payload &&
      github.context.payload.pull_request &&
      github.context.payload.pull_request.title

    if (inputs.titleWithTargetBranch == 'true') {
      title = `[Cherry-pick to ${branch}] ${title}`
    }

    core.info(`Using title '${title}'`)

    // Get PR body
    const body =
      github.context.payload &&
      github.context.payload.pull_request &&
      github.context.payload.pull_request.body
    core.info(`Using body '${body}'`)

    // Create PR
    const pull = await octokit.pulls.create({
      owner,
      repo,
      head: prBranch,
      base: branch,
      title,
      body
    })

    // Apply labels
    if (inputs.labels.length > 0) {
      const prLabels: Label[] =
        github.context.payload &&
        github.context.payload.pull_request &&
        github.context.payload.pull_request.labels

      if (prLabels) {
        for (const label of prLabels) {
          if (label.name !== inputs.branch) {
            inputs.labels.push(label.name)
          }
        }
      }
      // if allowUserToSpecifyBranchViaLabel is true, we
      // only want the branch label, configured labels, and PR labels to be applied
      // this is done with filterIrrelevantBranchLabels()
      core.info(`Applying labels '${inputs.labels}'`)
      await octokit.issues.addLabels({
        owner,
        repo,
        issue_number: pull.data.number,
        labels: inputs.allowUserToSpecifyBranchViaLabel
          ? utils.filterIrrelevantBranchLabels(inputs, inputs.labels, branch)
          : inputs.labels
      })
    }

    // Apply assignees
    if (inputs.assignees.length > 0) {
      core.info(`Applying assignees '${inputs.assignees}'`)
      await octokit.issues.addAssignees({
        owner,
        repo,
        issue_number: pull.data.number,
        assignees: inputs.assignees
      })
    }

    // Request reviewers and team reviewers
    try {
      if (inputs.reviewers.length > 0) {
        core.info(`Requesting reviewers '${inputs.reviewers}'`)
        await octokit.pulls.requestReviewers({
          owner,
          repo,
          pull_number: pull.data.number,
          reviewers: inputs.reviewers
        })
      }
      if (inputs.teamReviewers.length > 0) {
        core.info(`Requesting team reviewers '${inputs.teamReviewers}'`)
        await octokit.pulls.requestReviewers({
          owner,
          repo,
          pull_number: pull.data.number,
          team_reviewers: inputs.teamReviewers
        })
      }
    } catch (e: any) {
      if (e.message && e.message.includes(ERROR_PR_REVIEW_FROM_AUTHOR)) {
        core.warning(ERROR_PR_REVIEW_FROM_AUTHOR)
      } else {
        throw e
      }
    }
  }
}

export function buildBranchesFromLabels(inputs: Inputs): string[] {
  core.info(`inputs ${JSON.stringify(inputs)}`)
  const potentialBranches =
    github.context.payload &&
    github.context.payload.pull_request &&
    github.context.payload.pull_request.labels
  core.info(`potential branches ${JSON.stringify(potentialBranches)}`)
  const matchedLabels = potentialBranches.map(
    (branchToCheck: {name: string}) => {
      return utils.validatelabelPatternRequirement(
        inputs.labelPatternRequirement,
        branchToCheck.name
      )
    }
  )
  const filteredLabels: any = _.compact(matchedLabels)
  core.info(`branch labels ${JSON.stringify(filteredLabels)}`)
  return filteredLabels.map((matchedLabel: string) => {
    return utils.parseBranchFromLabel(inputs.userBranchPrefix, matchedLabel)
  })
}
