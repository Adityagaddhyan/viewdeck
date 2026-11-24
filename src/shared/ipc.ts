/**
 * The typed IPC contract between Electron main and the renderer.
 *
 * Rules (also listed in AGENTS.md):
 *  1. Every channel is declared here, in {@link IpcContract}. Nowhere else.
 *  2. Channel names are `<domain>:<action>` in camelCase.
 *  3. Requests and responses must be structured-clone serializable.
 *  4. Handlers resolve to `IpcResult<T>` and never throw across the boundary.
 *  5. The renderer reaches IPC only through `window.viewdeck` (preload).
 *     No `ipcRenderer` and no Node APIs in the renderer.
 *
 * Adding a channel: add it to `IpcContract`, register a handler in
 * `src/main/ipc/handlers/`, and record it in ARCHITECTURE.md § IPC channels.
 */
import type { UpdateStatus } from './update'
import type { IpcResult } from './types/result'
import type { AppSettings } from './settings'
import type {
  AwsProfile,
  CallerIdentity,
  OpenTunnelRequest,
  RdsDatabase,
  SsoStatus,
  TunnelInfo,
  TunnelTarget
} from './types/aws'
import type {
  QueryHistoryEntry,
  SavedQuery,
  SaveConnectionRequest,
  SavedConnection,
  SessionInfo
} from './types/connection'
import type {
  CellValue,
  ColumnInfo,
  CommitResult,
  ExplainResult,
  ForeignKeyInfo,
  PreparedStatement,
  QueryResult,
  SchemaInfo,
  SchemaObjects,
  SchemaSnapshot,
  SelectRowsOptions,
  StagedChangeset,
  TableDetails,
  TableInfo
} from './types/driver'

type SessionReq<T = object> = { sessionId: string } & T

/** Basic runtime info, used by the status bar and the smoke test. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
  node: string
  userDataPath: string
}

/** Request → response map for `ipcRenderer.invoke` / `ipcMain.handle` channels. */
export interface IpcContract {
  'app:getInfo': { request: void; response: AppInfo }
  /**
   * Writes text to the OS clipboard from main. The sandboxed renderer's
   * navigator.clipboard needs window focus and permission, which is flaky
   * inside menus, so grid copy actions go through main.
   */
  'app:writeClipboard': { request: { text: string }; response: void }
  /** Closes the window (Cmd+W with no tabs left). */
  'app:closeWindow': { request: void; response: void }
  /** Native "Save as…" for exports. Resolves the saved path, or null if cancelled. */
  'app:saveFile': { request: { defaultName: string; content: string }; response: { path: string | null } }

  /** Current update status (see UpdateStatus in src/shared/update.ts). */
  'update:getStatus': { request: void; response: UpdateStatus }
  /** Checks GitHub Releases now (menu "Check for Updates…"). Resolves with the new status. */
  'update:check': { request: void; response: UpdateStatus }
  /** Downloads, verifies and stages the available update. Progress arrives as `update:status`. */
  'update:download': { request: void; response: UpdateStatus }
  /** Quits, installs the staged update and relaunches the new version. */
  'update:restart': { request: void; response: void }

  /** Profiles parsed from ~/.aws/config and ~/.aws/credentials. No network. */
  'aws:listProfiles': { request: void; response: AwsProfile[] }
  /** Local SSO token cache check. No network. */
  'aws:getSsoStatus': { request: { profile: string }; response: SsoStatus }
  /**
   * Runs `aws sso login --profile <name>` and resolves when the CLI exits
   * (the user completes the browser flow). Can take minutes.
   */
  'aws:ssoLogin': { request: { profile: string }; response: SsoStatus }
  /** Kills an in-flight `aws sso login` for the profile, if any. */
  'aws:cancelSsoLogin': { request: { profile: string }; response: void }
  /** STS GetCallerIdentity: proves the profile's credentials actually work. */
  'aws:getCallerIdentity': { request: { profile: string; region: string }; response: CallerIdentity }
  /** Postgres-compatible RDS instances and clusters in one region. */
  'aws:listRdsDatabases': { request: { profile: string; region: string }; response: RdsDatabase[] }
  /** Running EC2 instances in `vpcId` whose SSM agent is Online. */
  'aws:listTunnelTargets': {
    request: { profile: string; region: string; vpcId: string }
    response: TunnelTarget[]
  }
  /** Checks that `aws` and `session-manager-plugin` are installed. */
  'aws:checkCliTools': {
    request: void
    response: { awsCli: string | null; sessionManagerPlugin: string | null }
  }

  /** Opens an SSM port-forward and resolves once it accepts connections. */
  'tunnel:open': { request: OpenTunnelRequest; response: TunnelInfo }
  'tunnel:close': { request: { id: string }; response: void }
  'tunnel:list': { request: void; response: TunnelInfo[] }

  /** Saved connections (no secrets are ever returned). */
  'connections:list': { request: void; response: SavedConnection[] }
  /** Insert or update. A plaintext `password` is encrypted in main immediately. */
  'connections:save': { request: SaveConnectionRequest; response: SavedConnection }
  'connections:delete': { request: { id: string }; response: void }
  /**
   * Copies a saved connection as "<name> (copy)". A saved password is
   * re-encrypted under a NEW secret, so deleting either copy never breaks the other.
   */
  'connections:duplicate': { request: { id: string }; response: SavedConnection }

  /** Opens a session for a saved connection (opens the SSM tunnel if needed). */
  'db:connect': { request: { connectionId: string }; response: SessionInfo }
  /** Connects once and disconnects. Accepts unsaved settings plus an optional password. */
  'db:testConnection': { request: SaveConnectionRequest; response: { serverVersion: string } }
  'db:disconnect': { request: SessionReq; response: void }
  'db:listSessions': { request: void; response: SessionInfo[] }
  /** Server-enforced read-only toggle (ADR-003). */
  'db:setReadOnly': { request: SessionReq<{ readOnly: boolean }>; response: SessionInfo }
  /** Plan for one statement (ANALYZE runs inside a rolled-back transaction). */
  'db:explain': { request: SessionReq<{ sql: string; analyze: boolean }>; response: ExplainResult }
  /** Latency probe for the status bar (SELECT 1 on a pool connection). */
  'db:ping': { request: SessionReq; response: { ms: number } }
  /** Cancels the query running in the editor (pg_cancel_backend). */
  'db:cancelQuery': { request: SessionReq; response: { cancelled: boolean } }
  /** Session-wide statement timeout in ms (0 = off). */
  'db:setStatementTimeout': { request: SessionReq<{ ms: number }>; response: SessionInfo }
  /** Runs SQL on the session's console client and records it in history. */
  'db:executeQuery': { request: SessionReq<{ sql: string; params?: CellValue[] }>; response: QueryResult }
  'db:listSchemas': { request: SessionReq; response: SchemaInfo[] }
  'db:listTables': { request: SessionReq<{ schema: string }>; response: TableInfo[] }
  'db:getTableColumns': { request: SessionReq<{ schema: string; table: string }>; response: ColumnInfo[] }
  'db:getPrimaryKeys': { request: SessionReq<{ schema: string; table: string }>; response: string[] }
  /** All schemas, tables and columns in one call, cached by the renderer for instant autocomplete. */
  'db:getSchemaSnapshot': { request: SessionReq; response: SchemaSnapshot }
  /** Table info panel: DDL, indexes, constraints, referencing FKs, triggers, stats. */
  'db:getTableDetails': { request: SessionReq<{ schema: string; table: string }>; response: TableDetails }
  /** Functions, sequences and user types in a schema (sidebar). */
  'db:listSchemaObjects': { request: SessionReq<{ schema: string }>; response: SchemaObjects }
  /** CREATE statement for a function / sequence / type (id from db:listSchemaObjects). */
  'db:getObjectDefinition': { request: SessionReq<{ kind: 'function' | 'sequence' | 'type'; id: string }>; response: string }
  /** Foreign keys out of / into a table, for row navigation in the grid. */
  'db:getForeignKeys': { request: SessionReq<{ schema: string; table: string }>; response: { outgoing: ForeignKeyInfo[]; incoming: ForeignKeyInfo[] } }
  /** Pager total: planner estimate, or exact COUNT(*) honouring the filter. */
  'db:countRows': { request: SessionReq<{ schema: string; table: string; exact: boolean; where?: string }>; response: { count: number | null; exact: boolean } }
  /** Browse a table (driver-quoted, paged; optional filter-bar WHERE / ORDER BY). */
  'db:selectRows': { request: SessionReq<{ schema: string; table: string } & SelectRowsOptions>; response: QueryResult }
  /** The exact statements commitChanges will run, for the SQL diff drawer. */
  'db:previewChanges': { request: SessionReq<{ changeset: StagedChangeset }>; response: PreparedStatement[] }
  'db:commitChanges': { request: SessionReq<{ changeset: StagedChangeset }>; response: CommitResult }

  'history:list': { request: { connectionId: string | null; limit?: number }; response: QueryHistoryEntry[] }
  /** Starred queries for a connection plus global ones. */
  'queries:list': { request: { connectionId: string | null }; response: SavedQuery[] }
  /** Create (no id) or update a starred query. */
  'queries:save': { request: { id?: string; connectionId: string | null; name: string; sql: string }; response: SavedQuery }
  'queries:delete': { request: { id: string }; response: void }
  'prefs:get': { request: { key: string }; response: unknown }
  'prefs:set': { request: { key: string; value: unknown }; response: void }
  /** App settings (normalised). Connection defaults (read-only, timeout per tier) apply to new sessions. */
  'settings:get': { request: void; response: AppSettings }
  'settings:set': { request: { settings: AppSettings }; response: AppSettings }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcResult<IpcContract[C]['response']>

/** Runtime list of channels. Preload uses it to allow-list `invoke` targets. */
export const IPC_CHANNELS = [
  'app:getInfo',
  'app:writeClipboard',
  'app:saveFile',
  'app:closeWindow',
  'update:getStatus',
  'update:check',
  'update:download',
  'update:restart',
  'aws:listProfiles',
  'aws:getSsoStatus',
  'aws:ssoLogin',
  'aws:cancelSsoLogin',
  'aws:getCallerIdentity',
  'aws:listRdsDatabases',
  'aws:listTunnelTargets',
  'aws:checkCliTools',
  'tunnel:open',
  'tunnel:close',
  'tunnel:list',
  'connections:list',
  'connections:save',
  'connections:delete',
  'connections:duplicate',
  'db:connect',
  'db:testConnection',
  'db:disconnect',
  'db:listSessions',
  'db:setReadOnly',
  'db:executeQuery',
  'db:explain',
  'db:ping',
  'db:cancelQuery',
  'db:setStatementTimeout',
  'db:listSchemas',
  'db:listTables',
  'db:getTableColumns',
  'db:getPrimaryKeys',
  'db:getSchemaSnapshot',
  'db:getTableDetails',
  'db:listSchemaObjects',
  'db:getObjectDefinition',
  'db:getForeignKeys',
  'db:countRows',
  'db:selectRows',
  'db:previewChanges',
  'db:commitChanges',
  'history:list',
  'queries:list',
  'queries:save',
  'queries:delete',
  'prefs:get',
  'prefs:set',
  'settings:get',
  'settings:set'
] as const satisfies readonly IpcChannel[]

/** Compile-time check that IPC_CHANNELS lists every key of IpcContract. */
type _AssertAllChannelsListed =
  Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]> extends never ? true : never
const _channelsComplete: _AssertAllChannelsListed = true
void _channelsComplete

/**
 * Main → renderer push events (`webContents.send`). Payloads must be serializable.
 * Like channels, every event is declared here and listed in IPC_EVENTS.
 */
export interface IpcEvents {
  /** Fired on every tunnel state transition (starting → ready → closed/failed). */
  'tunnel:status': TunnelInfo
  /** A session ended without the user asking (e.g. its tunnel died). */
  'session:lost': { sessionId: string; reason: string }
  /** A native menu item was clicked. The renderer performs the action. */
  'menu:command': { command: MenuCommand }
  /** Update lifecycle changed (checking, available, download progress, ready, error). */
  'update:status': UpdateStatus
}

/** Commands sent by the native menu (src/main/menu.ts) to the renderer. */
export type MenuCommand =
  | 'settings'
  | 'newQueryTab'
  | 'newConnection'
  | 'closeTab'
  | 'disconnect'
  | 'runStatement'
  | 'cancelQuery'
  | 'reviewChanges'
  | 'focusFilter'
  | 'palette'
  | 'nextTab'
  | 'prevTab'
  | 'checkForUpdates'

export type IpcEventName = keyof IpcEvents

export const IPC_EVENTS = ['tunnel:status', 'session:lost', 'menu:command', 'update:status'] as const satisfies readonly IpcEventName[]

type _AssertAllEventsListed =
  Exclude<IpcEventName, (typeof IPC_EVENTS)[number]> extends never ? true : never
const _eventsComplete: _AssertAllEventsListed = true
void _eventsComplete

/** Shape exposed on `window.viewdeck` by the preload script. */
export interface ViewDeckBridge {
  /** Subscribes to a push event. Returns an unsubscribe function. */
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcRequest<C> extends void ? [] : [IpcRequest<C>]
  ): Promise<IpcResponse<C>>
}
