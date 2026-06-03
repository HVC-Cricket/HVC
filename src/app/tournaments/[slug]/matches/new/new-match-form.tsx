"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MATCH_STAGE_LABEL, stagesForFormat } from "@/lib/constants/match";
import type { TournamentFormat } from "@/lib/constants/tournament";

import { createMatch } from "../actions";

const schema = z
  .object({
    stage: z.enum([
      "group",
      "qualifier",
      "qualifier_1",
      "eliminator",
      "qualifier_2",
      "quarter",
      "semi",
      "final",
      "exhibition",
    ]),
    team_a_id: z.string().uuid("Pick team A"),
    team_b_id: z.string().uuid("Pick team B"),
    scheduled_at: z.string().optional().or(z.literal("")),
    venue: z.string().optional().or(z.literal("")),
    overs_per_innings: z.coerce.number().int().positive().max(50),
    players_per_side: z.coerce.number().int().min(2).max(15),
  })
  .refine((d) => d.team_a_id !== d.team_b_id, {
    message: "Pick two different teams",
    path: ["team_b_id"],
  });

type FormValues = z.infer<typeof schema>;

type Props = {
  tournamentSlug: string;
  tournamentFormat: TournamentFormat;
  teams: { id: string; name: string; short_name: string }[];
  defaults: {
    overs_per_innings: number;
    players_per_side: number;
    venue: string;
  };
};

export function NewMatchForm({
  tournamentSlug,
  tournamentFormat,
  teams,
  defaults,
}: Props) {
  const stageOptions = stagesForFormat(tournamentFormat);
  const defaultStage = stageOptions.includes("group") ? "group" : stageOptions[0];
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      stage: defaultStage,
      team_a_id: "",
      team_b_id: "",
      scheduled_at: "",
      venue: defaults.venue,
      overs_per_innings: defaults.overs_per_innings,
      players_per_side: defaults.players_per_side,
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await createMatch({ tournamentSlug, ...values });
    if (result && !result.ok) {
      toast.error(result.error);
    }
  };

  // eslint-disable-next-line react-hooks/incompatible-library
  const teamAId = form.watch("team_a_id");
  const teamBId = form.watch("team_b_id");

  if (teams.length < 2) {
    return (
      <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="text-amber-700 dark:text-amber-300">
          At least two teams are required before scheduling a match.
        </p>
        <Link
          href={`/tournaments/${tournamentSlug}`}
          prefetch
          className="inline-flex"
        >
          <Button size="sm" variant="ghost">
            Back to tournament
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Section 1 — Stage + teams */}
        <section className="space-y-4">
          <FormField
            control={form.control}
            name="stage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stage</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a stage" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {stageOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {MATCH_STAGE_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="team_a_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team A</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="capitalize">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {teams
                        .filter((t) => t.id !== teamBId)
                        .map((t) => (
                          <SelectItem
                            key={t.id}
                            value={t.id}
                            className="capitalize"
                          >
                            {t.name}
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
              name="team_b_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team B</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="capitalize">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {teams
                        .filter((t) => t.id !== teamAId)
                        .map((t) => (
                          <SelectItem
                            key={t.id}
                            value={t.id}
                            className="capitalize"
                          >
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <hr className="border-foreground/10" />

        {/* Section 2 — When + where */}
        <section className="space-y-4">
          <FormField
            control={form.control}
            name="scheduled_at"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Scheduled at</FormLabel>
                <FormControl>
                  <DateInput type="datetime-local" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="venue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Venue</FormLabel>
                <FormControl>
                  <Input placeholder="Ground / location" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <hr className="border-foreground/10" />

        {/* Section 3 — Format settings */}
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="overs_per_innings"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Overs / innings</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} max={50} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="players_per_side"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Players / side</FormLabel>
                  <FormControl>
                    <Input type="number" min={2} max={15} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-foreground/10 pt-4">
          <Link href={`/tournaments/${tournamentSlug}`} prefetch>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Creating…" : "Create match"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
