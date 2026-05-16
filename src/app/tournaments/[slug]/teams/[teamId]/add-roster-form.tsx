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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
          render={({ field }) => (
            <FormItem>
              <FormLabel>Player</FormLabel>
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="capitalize">
                    <SelectValue placeholder="Select a player…" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {players.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      className="capitalize"
                    >
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
