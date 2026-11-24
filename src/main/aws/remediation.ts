/**
 * AppErrors for missing local tooling, with platform-specific install commands.
 * Shared by AwsProfileService (SSO login) and SsmTunnelManager (tunnels).
 */
import type { AppError } from '@shared/types/result'

export function awsCliMissingError(message: string): AppError {
  return {
    code: 'AWS_CLI_MISSING',
    message,
    hint: 'Install AWS CLI v2, then reopen this screen.',
    ...(process.platform === 'darwin' ? { command: 'brew install awscli' } : {}),
    docsUrl: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html'
  }
}

export function pluginMissingError(): AppError {
  return {
    code: 'SSM_PLUGIN_MISSING',
    message: 'The AWS Session Manager plugin is not installed.',
    hint: 'Private databases are reached through an SSM port-forwarding session, which needs this plugin next to the AWS CLI.',
    ...(process.platform === 'darwin' ? { command: 'brew install --cask session-manager-plugin' } : {}),
    docsUrl: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html'
  }
}

