/**
 * shadcn/ui-style ContextMenu on Radix (positioning, keyboard nav, submenus,
 * collision handling). Radix calls preventDefault on the DOM contextmenu event,
 * so main's native Cut/Copy/Paste menu doesn't also appear.
 */
import * as React from 'react'
import * as CM from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export const ContextMenu = CM.Root
export const ContextMenuTrigger = CM.Trigger
export const ContextMenuSub = CM.Sub

const panel =
  'z-50 min-w-48 overflow-hidden rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'

export function ContextMenuContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(panel, className)} collisionPadding={8} {...props} />
    </CM.Portal>
  )
}

const itemClass =
  'relative flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

export function ContextMenuItem({
  className,
  shortcut,
  destructive,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof CM.Item> & { shortcut?: string; destructive?: boolean }) {
  return (
    <CM.Item className={cn(itemClass, destructive && 'text-red-400 data-[highlighted]:text-red-300', className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[10px] tracking-wide text-muted-foreground">{shortcut}</span>}
    </CM.Item>
  )
}

export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof CM.SubTrigger>) {
  return (
    <CM.SubTrigger className={cn(itemClass, 'data-[state=open]:bg-accent', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </CM.SubTrigger>
  )
}

export function ContextMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent className={cn(panel, className)} collisionPadding={8} {...props} />
    </CM.Portal>
  )
}

export function ContextMenuSeparator() {
  return <CM.Separator className="-mx-1 my-1 h-px bg-border" />
}

export function ContextMenuLabel({ children }: { children: React.ReactNode }) {
  return <CM.Label className="truncate px-2 py-1 font-mono text-[10px] text-muted-foreground">{children}</CM.Label>
}
