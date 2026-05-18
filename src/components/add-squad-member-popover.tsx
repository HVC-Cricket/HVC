"use client";

import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { addPlayerToTeam } from "@/app/tournaments/[slug]/teams/actions";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

export type EligiblePlayer = {
  id: string;
  display_name: string;
  /** When set, the row renders disabled with this string shown as a
   *  small reason underneath the name — e.g. "Already in Yo". */
  locked_reason?: string | null;
};

/**
 * Lightweight inline "Add player to this team's squad" trigger.
 * Renders as a small outline button → on click, opens a searchable
 * combobox of every player in the registry. Picking one fires
 * `addPlayerToTeam` with `role: "player"` (captain / vice-captain
 * still get set from the team page).
 *
 * Players already in another team in the same tournament show as
 * disabled rows with a "Already in <team>" reason — clearer than
 * letting the user pick and then surfacing a server-side error.
 *
 * Used on the match detail page (XISection card) and the Pick XI
 * page; both render this above their existing pickers so an
 * organizer doesn't have to bounce to the team page to add a 6th
 * squad member.
 */
export function AddSquadMemberPopover({
  tournamentSlug,
  teamId,
  players,
  label = "Add player",
  align = "end",
}: {
  tournamentSlug: string;
  teamId: string;
  players: EligiblePlayer[];
  label?: string;
  align?: "start" | "center" | "end";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSelect = (playerId: string) => {
    setOpen(false);
    startTransition(async () => {
      const res = await addPlayerToTeam({
        tournamentSlug,
        teamId,
        playerId,
        role: "player",
      });
      if (res && !res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Player added to squad");
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || players.length === 0}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            <span>{label}</span>
            <ChevronsUpDown className="size-3 opacity-50" />
          </Button>
        )}
      />
      <PopoverContent
        className="w-[min(280px,calc(100vw-1.5rem))] p-0"
        align={align}
      >
        <Command
          // Search on display_name only. The cmdk value packs the id
          // for de-dupe (two players with the same display name); the
          // custom filter strips the trailing id token before matching.
          filter={(value, search) => {
            const lastSpace = value.lastIndexOf(" ");
            const name =
              lastSpace >= 0 ? value.slice(0, lastSpace) : value;
            return name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search players…" />
          <CommandList>
            <CommandEmpty>No player found.</CommandEmpty>
            <CommandGroup>
              {players.map((p) => {
                const locked = !!p.locked_reason;
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.display_name} ${p.id}`}
                    disabled={locked}
                    onSelect={() => {
                      if (!locked) onSelect(p.id);
                    }}
                    className={cn(
                      "flex flex-col items-start gap-0 capitalize",
                      locked && "opacity-60",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Check className="mr-0 size-4 opacity-0" />
                      <span>{p.display_name}</span>
                    </span>
                    {p.locked_reason && (
                      <span className="pl-6 text-[10px] normal-case text-muted-foreground">
                        {p.locked_reason}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
