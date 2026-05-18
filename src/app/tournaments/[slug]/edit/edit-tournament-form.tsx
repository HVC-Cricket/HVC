"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { CategoryOversFields } from "@/components/category-overs-fields";
import { ConfirmButton } from "@/components/confirm-button";
import { DateInput } from "@/components/ui/date-input";
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
import { LogoUploader } from "@/components/logo-uploader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { deleteTournament, updateTournament } from "../../actions";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, digits, hyphens only"),
  format: z.enum([
    "league",
    "knockout",
    "group_then_knockout",
    "round_robin_playoff_final",
  ]),
  status: z.enum(["draft", "active", "completed", "archived"]),
  default_overs_per_innings: z.coerce.number().int().positive().max(50),
  default_players_per_side: z.coerce.number().int().min(2).max(15),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  venue: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  logo_url: z.string().url().nullable().optional(),
  cat1_overs: z.array(z.number().int().positive()),
  cat3_overs: z.array(z.number().int().positive()),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  tournament: {
    id: string;
    name: string;
    slug: string;
    format:
      | "league"
      | "knockout"
      | "group_then_knockout"
      | "round_robin_playoff_final";
    status: "draft" | "active" | "completed" | "archived";
    default_overs_per_innings: number;
    default_players_per_side: number;
    start_date: string | null;
    end_date: string | null;
    venue: string | null;
    description: string | null;
    logo_url: string | null;
    cat1_overs: number[];
    cat3_overs: number[];
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
      logo_url: tournament.logo_url ?? null,
      cat1_overs: tournament.cat1_overs,
      cat3_overs: tournament.cat3_overs,
    },
  });
  const overs = form.watch("default_overs_per_innings");
  const cat1Overs = form.watch("cat1_overs");
  const cat3Overs = form.watch("cat3_overs");

  const onSubmit = async (values: FormValues) => {
    const result = await updateTournament({ id: tournament.id, ...values });
    if (result && !result.ok) {
      toast.error(result.error);
    }
  };

  const onDelete = () => {
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
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Format</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Format" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="league">League</SelectItem>
                    <SelectItem value="knockout">Knockout</SelectItem>
                    <SelectItem value="group_then_knockout">
                      Group then knockout
                    </SelectItem>
                    <SelectItem value="round_robin_playoff_final">
                      Round Robin → Playoff → Final
                    </SelectItem>
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
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
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
                  <DateInput {...field} />
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
                  <DateInput {...field} />
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
        <FormField
          control={form.control}
          name="logo_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Logo</FormLabel>
              <FormControl>
                <LogoUploader
                  bucket="tournament-logos"
                  value={field.value ?? null}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormDescription>PNG or JPG, up to 2 MB.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* HVC category-over scheduling. Pick which over numbers are
            Cat 1 (amber) / Cat 3 (sky); the rest fall through as
            Cat 2 ("open"). Empty = no category enforcement for that
            tier. Per-match overrides live on the match edit form. */}
        <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Category overs</div>
            <p className="text-[11px] text-muted-foreground">
              Default Cat 1 / Cat 3 schedule for every match in this
              tournament. A single match can override via its edit form.
            </p>
          </div>
          <CategoryOversFields
            overs={Number(overs) || 1}
            cat1Overs={cat1Overs}
            cat3Overs={cat3Overs}
            onChange={(next) => {
              form.setValue("cat1_overs", next.cat1Overs, {
                shouldDirty: true,
              });
              form.setValue("cat3_overs", next.cat3Overs, {
                shouldDirty: true,
              });
            }}
          />
        </div>

        {/* URL slug is rarely touched and risky to change — bury it in
            an Advanced section so the main form stays focused on the
            fields people actually edit. */}
        <details className="group rounded-lg border border-foreground/10 bg-muted/20">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="transition group-open:rotate-90">▸</span>
              Advanced
            </span>
          </summary>
          <div className="border-t border-foreground/10 p-3">
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
                    Used in /tournaments/{`{slug}`}. Changing this breaks
                    existing links and bookmarks — leave it alone unless
                    you really need to rename the URL.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </details>

        <div className="flex items-center justify-between gap-4 pt-2">
          <ConfirmButton
            title={`Delete "${tournament.name}"?`}
            description="This cascades to all teams, matches, and scoring data. This cannot be undone."
            confirmLabel="Delete tournament"
            destructive
            onConfirm={onDelete}
            triggerProps={{
              type: "button",
              variant: "ghost",
              className: "text-destructive hover:text-destructive",
              disabled: deleting || form.formState.isSubmitting,
            }}
          >
            {deleting ? "Deleting…" : "Delete tournament"}
          </ConfirmButton>
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
