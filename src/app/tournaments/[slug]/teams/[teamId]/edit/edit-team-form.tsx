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

import { deleteTeam, updateTeam } from "../../actions";

const schema = z.object({
  name: z.string().min(2, "Team name must be at least 2 characters"),
  short_name: z.string().min(2).max(5, "Short name is 2–5 characters"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Hex like #1f6feb")
    .optional()
    .or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  tournamentSlug: string;
  team: {
    id: string;
    name: string;
    short_name: string;
    color: string | null;
  };
};

export function EditTeamForm({ tournamentSlug, team }: Props) {
  const [deleting, startDelete] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: team.name,
      short_name: team.short_name,
      color: team.color ?? "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await updateTeam({
      tournamentSlug,
      teamId: team.id,
      ...values,
    });
    if (result && !result.ok) {
      toast.error(result.error);
    }
  };

  const onDelete = () => {
    if (
      !window.confirm(
        `Delete team "${team.name}"? Roster entries are removed automatically. Matches involving this team would also need to be reassigned.`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const result = await deleteTeam({ tournamentSlug, teamId: team.id });
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
              <FormLabel>Team name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="short_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Short name</FormLabel>
              <FormControl>
                <Input
                  maxLength={5}
                  {...field}
                  onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                />
              </FormControl>
              <FormDescription>2–5 letters, shown on scorecards.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="color"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Color (hex)</FormLabel>
              <FormControl>
                <Input placeholder="#1f6feb" {...field} />
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
            {deleting ? "Deleting…" : "Delete team"}
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
