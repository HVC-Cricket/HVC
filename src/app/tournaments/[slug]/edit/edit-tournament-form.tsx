"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { deleteTournament, updateTournament } from "../../actions";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, digits, hyphens only"),
  format: z.enum(["league", "knockout", "group_then_knockout"]),
  status: z.enum(["draft", "active", "completed", "archived"]),
  default_overs_per_innings: z.coerce.number().int().positive().max(50),
  default_players_per_side: z.coerce.number().int().min(2).max(15),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  venue: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  tournament: {
    id: string;
    name: string;
    slug: string;
    format: "league" | "knockout" | "group_then_knockout";
    status: "draft" | "active" | "completed" | "archived";
    default_overs_per_innings: number;
    default_players_per_side: number;
    start_date: string | null;
    end_date: string | null;
    venue: string | null;
    description: string | null;
  };
};

export function EditTournamentForm({ tournament }: Props) {
  const [deleting, startDelete] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: tournament.name,
      slug: tournament.slug,
      format: tournament.format,
      status: tournament.status,
      default_overs_per_innings: tournament.default_overs_per_innings,
      default_players_per_side: tournament.default_players_per_side,
      start_date: tournament.start_date ?? "",
      end_date: tournament.end_date ?? "",
      venue: tournament.venue ?? "",
      description: tournament.description ?? "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await updateTournament({ id: tournament.id, ...values });
    if (result && !result.ok) {
      toast.error(result.error);
    }
  };

  const onDelete = () => {
    if (
      !window.confirm(
        `Delete "${tournament.name}"? This cascades to all teams, matches, and scoring data. This cannot be undone.`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const result = await deleteTournament({ tournamentId: tournament.id });
      if (result && !result.ok) {
        toast.error(result.error);
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>URL slug</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>
                Used in /tournaments/{`{slug}`}. Changing this breaks bookmarks.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Format</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="league">League</option>
                    <option value="knockout">Knockout</option>
                    <option value="group_then_knockout">
                      Group then knockout
                    </option>
                  </select>
                </FormControl>
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
                <FormControl>
                  <select
                    {...field}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="default_overs_per_innings"
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
            name="default_players_per_side"
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
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="start_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="end_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
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
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  rows={3}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-between gap-4 pt-2">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={deleting || form.formState.isSubmitting}
            onClick={onDelete}
          >
            {deleting ? "Deleting…" : "Delete tournament"}
          </Button>
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || deleting}
          >
            {form.formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
