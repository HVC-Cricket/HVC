"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
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

import {
  deleteMatch,
  updateMatch,
} from "@/app/tournaments/[slug]/matches/actions";

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
    status: z.enum([
      "scheduled",
      "live",
      "innings_break",
      "completed",
      "abandoned",
    ]),
    team_a_id: z.string().uuid(),
    team_b_id: z.string().uuid(),
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
  match: {
    id: string;
    stage: FormValues["stage"];
    status: FormValues["status"];
    team_a_id: string;
    team_b_id: string;
    scheduled_at: string | null;
    venue: string | null;
    overs_per_innings: number;
    players_per_side: number;
  };
  tournamentFormat: TournamentFormat;
  teams: { id: string; name: string; short_name: string }[];
};

export function EditMatchForm({ match, tournamentFormat, teams }: Props) {
  // Curate the stage dropdown for the tournament's format. Include the
  // match's existing stage even if it wouldn't normally surface for
  // this format — so the user sees their current selection.
  const stageOptionsBase = stagesForFormat(tournamentFormat);
  const stageOptions = stageOptionsBase.includes(match.stage)
    ? stageOptionsBase
    : ([match.stage, ...stageOptionsBase] as typeof stageOptionsBase);
  const [deleting, startDelete] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      stage: match.stage,
      status: match.status,
      team_a_id: match.team_a_id,
      team_b_id: match.team_b_id,
      scheduled_at: toDatetimeLocal(match.scheduled_at),
      venue: match.venue ?? "",
      overs_per_innings: match.overs_per_innings,
      players_per_side: match.players_per_side,
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await updateMatch({ matchId: match.id, ...values });
    if (result && !result.ok) {
      toast.error(result.error);
    }
  };

  const onDelete = () => {
    startDelete(async () => {
      const result = await deleteMatch({ matchId: match.id });
      if (result && !result.ok) {
        toast.error(result.error);
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="stage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stage</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Stage" />
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
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="innings_break">
                      Innings break
                    </SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="abandoned">Abandoned</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
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
                    {teams.map((t) => (
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
                    {teams.map((t) => (
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
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
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
        <div className="flex items-center justify-between gap-4 pt-2">
          <ConfirmButton
            title="Delete this match?"
            description="Innings, balls, and squad entries are removed via cascade. This cannot be undone."
            confirmLabel="Delete match"
            destructive
            onConfirm={onDelete}
            triggerProps={{
              type: "button",
              variant: "ghost",
              className: "text-destructive hover:text-destructive",
              disabled: deleting || form.formState.isSubmitting,
            }}
          >
            {deleting ? "Deleting…" : "Delete match"}
          </ConfirmButton>
          <Button type="submit" disabled={form.formState.isSubmitting || deleting}>
            {form.formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  // ISO from Postgres is UTC; the <input type="datetime-local"> wants
  // a local string in the form `YYYY-MM-DDTHH:mm`.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
