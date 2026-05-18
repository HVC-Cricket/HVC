"use client";

import {
  Check,
  ChevronsUpDown,
  Loader2,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, getInitials } from "@/lib/utils";

import { deleteUser, setLinkedPlayer, setSuperAdmin } from "./actions";

export type MemberRow = {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  organizerCount: number;
  scorerCount: number;
  linkedPlayer: {
    id: string;
    displayName: string;
    photoUrl: string | null;
  } | null;
  joinedAt: string;
};

export type PlayerOption = {
  id: string;
  displayName: string;
  linkedUserId: string | null;
};

export function MembersTable({
  rows,
  playerOptions,
  currentUserId,
}: {
  rows: MemberRow[];
  playerOptions: PlayerOption[];
  /** Id of the signed-in super-admin. The delete-user control on
   *  that row gets hidden — we never allow self-delete from here. */
  currentUserId: string;
}) {
  const [query, setQuery] = useState("");
  // useDeferredValue keeps the input responsive when the filtered set
  // is large enough that re-rendering noticeably blocks typing.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q),
    );
  }, [rows, deferredQuery]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Members</CardTitle>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {query
              ? `${filtered.length} of ${rows.length}`
              : `${rows.length} total`}
          </span>
        </div>
        {/* Match the players-list search shell — flex row instead of
            an absolutely-positioned icon so Tailwind v4's px-2.5 on
            <Input> doesn't fight the icon position. */}
        <label className="flex h-10 items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search members"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="-mr-1 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </label>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="px-4 pb-6 pt-2 text-sm text-muted-foreground sm:px-6">
            No members match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {filtered.map((row) => (
              <MemberItem
                key={row.userId}
                row={row}
                playerOptions={playerOptions}
                isSelf={row.userId === currentUserId}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MemberItem({
  row,
  playerOptions,
  isSelf,
}: {
  row: MemberRow;
  playerOptions: PlayerOption[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const roleLabel = pickRoleLabel(row);

  const onToggleSuper = () => {
    startTransition(async () => {
      const res = await setSuperAdmin(row.userId, !row.isSuperAdmin);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        row.isSuperAdmin
          ? `${row.displayName || row.email} demoted`
          : `${row.displayName || row.email} promoted to super-admin`,
      );
      router.refresh();
    });
  };

  const onDelete = () => {
    startTransition(async () => {
      const res = await deleteUser(row.userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${row.displayName || row.email} deleted`);
      router.refresh();
    });
  };

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
      <Avatar
        photoUrl={row.avatarUrl}
        fallback={row.displayName || row.email}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium capitalize">
            {row.displayName || "(no name)"}
          </span>
          <RoleBadge label={roleLabel.label} classes={roleLabel.classes} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {row.email}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Joined {new Date(row.joinedAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </div>
      </div>

      <div className="flex flex-col items-start gap-2 sm:items-end">
        <PlayerLinkControl
          row={row}
          playerOptions={playerOptions}
          disabled={pending}
        />
        <div className="flex items-center gap-2">
          <SuperAdminToggle
            row={row}
            disabled={pending}
            onConfirm={onToggleSuper}
          />
          {!isSelf && (
            <DeleteUserButton
              row={row}
              disabled={pending}
              onConfirm={onDelete}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function DeleteUserButton({
  row,
  disabled,
  onConfirm,
}: {
  row: MemberRow;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Delete ${row.displayName || row.email}`}
          disabled={disabled}
          className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {row.displayName || row.email}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes their auth account permanently. Any linked
            player record stays but is unlinked from this user.
            Match history is unaffected. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Avatar({
  photoUrl,
  fallback,
}: {
  photoUrl: string | null;
  fallback: string;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        className="size-10 shrink-0 rounded-full border border-foreground/10 object-cover"
      />
    );
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
      {getInitials(fallback)}
    </span>
  );
}

function RoleBadge({
  label,
  classes,
}: {
  label: string;
  classes: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
        classes
      }
    >
      {label}
    </span>
  );
}

function pickRoleLabel(row: MemberRow): { label: string; classes: string } {
  if (row.isSuperAdmin) {
    return {
      label: "Super admin",
      classes: "border-primary/30 bg-primary/10 text-primary",
    };
  }
  if (row.organizerCount > 0) {
    return {
      label: row.organizerCount > 1 ? `Organizer · ${row.organizerCount}` : "Organizer",
      classes:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (row.scorerCount > 0) {
    return {
      label: row.scorerCount > 1 ? `Scorer · ${row.scorerCount}` : "Scorer",
      classes:
        "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    };
  }
  if (row.linkedPlayer) {
    return {
      label: "Player",
      classes:
        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  return {
    label: "Member",
    classes: "border-foreground/15 bg-muted text-muted-foreground",
  };
}

function SuperAdminToggle({
  row,
  disabled,
  onConfirm,
}: {
  row: MemberRow;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const willPromote = !row.isSuperAdmin;
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={row.isSuperAdmin ? "outline" : "default"}
          disabled={disabled}
        >
          {disabled ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : row.isSuperAdmin ? (
            "Demote"
          ) : (
            "Promote to super-admin"
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {willPromote
              ? `Make ${row.displayName || row.email} a super-admin?`
              : `Step down ${row.displayName || row.email}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {willPromote
              ? "Super-admins can manage every tournament, player, and other super-admins."
              : "They'll lose access to the admin page and to cross-tournament writes."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {willPromote ? "Promote" : "Demote"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PlayerLinkControl({
  row,
  playerOptions,
  disabled,
}: {
  row: MemberRow;
  playerOptions: PlayerOption[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Eligible to link: any player not yet linked, plus the currently-
  // linked player (so the trigger still shows its name).
  const linkable = playerOptions.filter(
    (p) => !p.linkedUserId || p.linkedUserId === row.userId,
  );

  const onSelect = (playerId: string | null) => {
    setOpen(false);
    startTransition(async () => {
      const res = await setLinkedPlayer(row.userId, playerId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        playerId === null
          ? `${row.displayName || row.email} unlinked`
          : `${row.displayName || row.email} linked to player`,
      );
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={(props) => (
            <Button
              {...props}
              type="button"
              size="sm"
              variant="ghost"
              role="combobox"
              aria-expanded={open}
              disabled={disabled || pending}
              className={cn(
                "h-8 max-w-[200px] justify-between gap-1.5 px-2 capitalize",
                !row.linkedPlayer && "text-muted-foreground",
              )}
            >
              <UserRound className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">
                {row.linkedPlayer
                  ? row.linkedPlayer.displayName
                  : "Link player"}
              </span>
              <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
            </Button>
          )}
        />
        <PopoverContent
          // Mobile-safe sizing: never wider than the viewport (minus
          // a small inset) and capped vertically so the popup can
          // always fit inside the visible area. `align="start"`
          // anchors the popup's left edge to the trigger's left
          // edge, which keeps it on-screen when the trigger sits on
          // the right side of a narrow row — `align="end"` was
          // causing the page to scroll up when base-ui's auto-focus
          // moved focus to a CommandInput that had ended up
          // off-screen above the trigger after a collision flip.
          className="w-[min(280px,calc(100vw-1.5rem))] max-h-[60vh] overflow-hidden p-0"
          align="start"
        >
          <Command
            // See add-roster-form.tsx for the same trick: cmdk dedupes
            // items by value, so suffix with id to keep duplicate
            // names distinct, then strip the trailing id token
            // before fuzzy-matching.
            filter={(value, search) => {
              const lastSpace = value.lastIndexOf(" ");
              const name =
                lastSpace >= 0 ? value.slice(0, lastSpace) : value;
              return name.toLowerCase().includes(search.toLowerCase())
                ? 1
                : 0;
            }}
          >
            <CommandInput placeholder="Search players…" />
            <CommandList>
              <CommandEmpty>No player found.</CommandEmpty>
              <CommandGroup>
                {linkable.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.displayName} ${p.id}`}
                    onSelect={() => onSelect(p.id)}
                    className="capitalize"
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        row.linkedPlayer?.id === p.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {p.displayName}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {row.linkedPlayer && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label="Unlink player"
          disabled={disabled || pending}
          onClick={() => onSelect(null)}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
