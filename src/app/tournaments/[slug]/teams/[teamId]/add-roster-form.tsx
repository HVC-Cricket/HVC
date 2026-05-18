"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { addPlayerToTeam } from "../actions";

const schema = z.object({
  playerId: z.string().uuid("Pick a player"),
  role: z.enum(["captain", "vice_captain", "wicket_keeper", "player"]),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  tournamentSlug: string;
  teamId: string;
  players: { id: string; display_name: string }[];
  /** False when the caller is a team admin (not organizer) — they
   *  can add players but not set them as captain / vice-captain. */
  canChangeCaptaincy: boolean;
};

export function AddRosterForm({
  tournamentSlug,
  teamId,
  players,
  canChangeCaptaincy,
}: Props) {
  const [playerPopoverOpen, setPlayerPopoverOpen] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { playerId: "", role: "player" },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await addPlayerToTeam({
      tournamentSlug,
      teamId,
      playerId: values.playerId,
      role: values.role,
    });
    if (result && !result.ok) {
      toast.error(result.error);
      return;
    }
    form.reset({ playerId: "", role: "player" });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="playerId"
          render={({ field }) => {
            const selected = players.find((p) => p.id === field.value);
            return (
              <FormItem>
                <FormLabel>Player</FormLabel>
                <Popover
                  open={playerPopoverOpen}
                  onOpenChange={setPlayerPopoverOpen}
                >
                  {/* base-ui's PopoverTrigger uses `render` (not asChild)
                      to compose with a custom element. Dropping FormControl
                      here — its only contribution is wiring aria-describedby
                      to FormMessage, which doesn't apply to a combobox
                      trigger button. The visible FormMessage still renders
                      below on validation failure. */}
                  <PopoverTrigger
                    render={(props) => (
                      <Button
                        {...props}
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={playerPopoverOpen}
                        className={cn(
                          "w-full justify-between capitalize",
                          !selected && "text-muted-foreground",
                        )}
                      >
                        {selected ? selected.display_name : "Select a player…"}
                        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                      </Button>
                    )}
                  />
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                  >
                    <Command
                      // Search on display_name only even though `value` is
                      // suffixed with the player id (cmdk de-dupes by value
                      // — two "Aditya"s would otherwise collapse). The id
                      // is always the last whitespace-separated token.
                      filter={(value, search) => {
                        const lastSpace = value.lastIndexOf(" ");
                        const name =
                          lastSpace >= 0 ? value.slice(0, lastSpace) : value;
                        return name
                          .toLowerCase()
                          .includes(search.toLowerCase())
                          ? 1
                          : 0;
                      }}
                    >
                      <CommandInput placeholder="Search players…" />
                      <CommandList>
                        <CommandEmpty>No player found.</CommandEmpty>
                        <CommandGroup>
                          {players.map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.display_name} ${p.id}`}
                              onSelect={() => {
                                field.onChange(p.id);
                                setPlayerPopoverOpen(false);
                              }}
                              className="capitalize"
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  field.value === p.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              {p.display_name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="player">Player</SelectItem>
                  {canChangeCaptaincy && (
                    <SelectItem value="captain">Captain</SelectItem>
                  )}
                  {canChangeCaptaincy && (
                    <SelectItem value="vice_captain">Vice captain</SelectItem>
                  )}
                  <SelectItem value="wicket_keeper">
                    Wicket-keeper
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Adding…" : "Add to squad"}
        </Button>
      </form>
    </Form>
  );
}
