/**
 * The ⓘ panel: what every line, end marker, badge and card icon in the diagram means,
 * drawn with the same SVG markers the edges use (RelationMarkers must be mounted).
 */
import { Eye, ExternalLink, KeyRound, Link2, X } from 'lucide-react'

function Sample({ start, end, dashed, color = 'var(--muted-foreground)', variant = 'base' }: { start?: string; end?: string; dashed?: boolean; color?: string; variant?: string }) {
  return (
    <svg width="96" height="24" className="shrink-0" aria-hidden>
      <line
        x1="6"
        y1="12"
        x2="90"
        y2="12"
        stroke={color}
        strokeWidth="1.4"
        strokeDasharray={dashed ? '5 4' : undefined}
        markerStart={start ? `url(#vd-${start}-${variant})` : undefined}
        markerEnd={end ? `url(#vd-${end}-${variant})` : undefined}
      />
    </svg>
  )
}

const Row = ({ sample, title, text }: { sample: React.ReactNode; title: string; text: string }) => (
  <div className="flex items-center gap-3 py-1">
    {sample}
    <div className="min-w-0">
      <div className="font-medium">{title}</div>
      <div className="text-muted-foreground">{text}</div>
    </div>
  </div>
)

export function DiagramLegend({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Diagram legend" className="absolute left-3 top-12 z-20 max-h-[calc(100%-4rem)] w-[400px] overflow-auto rounded-lg border bg-popover p-3 text-[11.5px] text-popover-foreground shadow-xl">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-semibold">How to read the diagram</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close legend">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="mb-2 text-muted-foreground">
        Lines run from the <b>referenced</b> table (left end) to the table holding the foreign key (right end), in crow's-foot notation.
      </p>
      <Row sample={<Sample start="one" end="many" />} title="Many-to-one, required" text="Each row on the right points to exactly one row on the left (FK is NOT NULL)." />
      <Row sample={<Sample start="zeroOne" end="many" />} title="Many-to-one, optional" text="The FK column can be NULL: zero or one parent." />
      <Row sample={<Sample start="one" end="oneChild" />} title="One-to-one" text="The FK is also the table's primary or unique key: at most one child per parent." />
      <Row sample={<Sample start="one" end="many" dashed color="rgb(217 119 6)" variant="inf" />} title="Inferred (dashed amber)" text="No foreign key in the database; guessed from naming like customer_id → customers.id. Hover to see why." />
      <Row
        sample={
          <span className="inline-flex w-[96px] justify-center">
            <span className="rounded-full border border-red-500/60 px-1 text-[9px] font-semibold text-red-600 dark:text-red-400">✕ cascade</span>
          </span>
        }
        title="ON DELETE CASCADE"
        text="Deleting the parent row deletes these child rows too."
      />
      <Row
        sample={
          <svg width="96" height="24" aria-hidden>
            <path d="M 30 16 C 60 16, 60 2, 22 6" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.4" />
            <rect x="4" y="6" width="22" height="14" rx="3" fill="none" stroke="var(--muted-foreground)" />
          </svg>
        }
        title="Self-reference"
        text="A table pointing at itself, e.g. parent_id for trees."
      />
      <Row sample={<Sample start="one" end="many" color="rgb(14 165 233)" variant="hi" />} title="Highlighted (blue)" text="Relationships of the focused table." />
      <Row sample={<Sample start="one" end="many" color="rgb(245 158 11)" variant="path" />} title="Join path (orange)" text="The route found by “How are these related?”." />

      <div className="mt-2 border-t pt-2 text-[11px]">
        <div className="mb-1 font-medium">Cards</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
          <span className="flex items-center gap-1"><KeyRound className="size-3 text-amber-500" /> primary key column</span>
          <span className="flex items-center gap-1"><Link2 className="size-3 text-sky-500" /> column in a relationship</span>
          <span className="flex items-center gap-1"><Eye className="size-3" /> view / materialized view</span>
          <span className="flex items-center gap-1"><ExternalLink className="size-3" /> table in another schema (dashed card)</span>
          <span>Coloured boxes: clusters of closely related tables, named after their most connected table.</span>
          <span>Number on a card: estimated rows.</span>
        </div>
        <div className="mt-2 font-medium">Tips</div>
        <ul className="list-disc pl-4 text-muted-foreground">
          <li>Click a table to focus it and its neighbours; click again for 2 hops; Esc clears.</li>
          <li>Double-click a table to open its data. Drag cards to rearrange (remembered).</li>
          <li>Zoom out for the map view; zoom in to see columns. Hover anything for details.</li>
        </ul>
      </div>
    </div>
  )
}
