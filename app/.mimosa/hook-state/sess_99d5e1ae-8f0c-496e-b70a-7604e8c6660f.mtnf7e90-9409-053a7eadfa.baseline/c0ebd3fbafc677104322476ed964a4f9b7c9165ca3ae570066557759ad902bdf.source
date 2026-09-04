import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Global card system — the ONE canonical card structure for the whole app.
 *
 *   Card        rounded-lg border bg-card (flex column, clips children)
 *   CardHeader  p-5 pb-3   — CardTitle text-base font-medium on top,
 *                            CardDescription text-sm text-muted-foreground below
 *   CardContent p-5 pt-0   (first:pt-5 when a card renders no header)
 *   CardFooter  p-5 pt-0
 *   CardAction  pinned to the header's top-right corner
 *
 * The previous implementation used Tailwind v4-only syntax
 * (`py-(--card-spacing)` etc.) which never compiled under Tailwind 3, so every
 * card rendered with zero inner padding. These classes are Tailwind-3-safe.
 *
 * Need different spacing? Compose these primitives or pass className — never
 * re-declare padding/radius/border on a raw div.
 */

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col overflow-hidden rounded-lg border border-border bg-card text-sm text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min items-start gap-1 p-5 pb-3 has-[[data-slot=card-action]]:grid-cols-[1fr_auto]",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-base leading-snug font-medium", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("p-5 pt-0 first:pt-5", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center p-5 pt-0 first:pt-5", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
