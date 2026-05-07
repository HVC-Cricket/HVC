"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { addPlayerToTeam } from "../actions";

const schema = z.object({
  playerId: z.string().uuid("Pick a player"),
  jersey_number: z
    .union([z.string().length(0), z.coerce.number().int().min(0).max(999)])
    .optional(),
  role: z.enum(["captain", "vice_captain", "wicket_keeper", "player"]),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  tournamentSlug: string;
  teamId: string;
  players: { id: string; display_name: string }[];
};

export function AddRosterForm({ tournamentSlug, teamId, players }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { playerId: "", jersey_number: "", role: "player" },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await addPlayerToTeam({
      tournamentSlug,
      teamId,
      playerId: values.playerId,
      jersey_number:
        typeof values.jersey_number === "number" ? values.jersey_number : undefined,
      role: values.role,
    });
    if (result && !result.ok) {
      toast.error(result.error);
      return;
    }
    form.reset({ playerId: "", jersey_number: "", role: "player" });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="playerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Player</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                >
                  <option value="">Select a player…</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="jersey_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Jersey #</FormLabel>
                <FormControl>
                  <Input type="number" min={0} max={999} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Role</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="player">Player</option>
                    <option value="captain">Captain</option>
                    <option value="vice_captain">Vice captain</option>
                    <option value="wicket_keeper">Wicket-keeper</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Adding…" : "Add to roster"}
        </Button>
      </form>
    </Form>
  );
}
