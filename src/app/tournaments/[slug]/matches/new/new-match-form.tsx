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

import { createMatch } from "../actions";

const schema = z
  .object({
    stage: z.enum(["group", "qualifier", "quarter", "semi", "final", "exhibition"]),
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
  teams: { id: string; name: string; short_name: string }[];
  defaults: {
    overs_per_innings: number;
    players_per_side: number;
    venue: string;
  };
};

export function NewMatchForm({ tournamentSlug, teams, defaults }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      stage: "group",
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

  if (teams.length < 2) {
    return (
      <div className="rounded-md border border-foreground/10 bg-muted/30 p-4 text-sm text-muted-foreground">
        At least two teams are required before scheduling a match. Add teams
        first on the tournament page.
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="stage"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stage</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                >
                  <option value="group">Group</option>
                  <option value="qualifier">Qualifier</option>
                  <option value="quarter">Quarter-final</option>
                  <option value="semi">Semi-final</option>
                  <option value="final">Final</option>
                  <option value="exhibition">Exhibition</option>
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="team_a_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Team A</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="">Select…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </FormControl>
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
                <FormControl>
                  <select
                    {...field}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="">Select…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </FormControl>
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
                <Input type="datetime-local" {...field} />
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
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Creating…" : "Create match"}
        </Button>
      </form>
    </Form>
  );
}
