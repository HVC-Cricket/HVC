"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { CategoryOversFields } from "@/components/category-overs-fields";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createTournament } from "../actions";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  format: z.enum([
    "league",
    "knockout",
    "group_then_knockout",
    "round_robin_playoff_final",
  ]),
  default_overs_per_innings: z.coerce
    .number({ invalid_type_error: "Enter a number" })
    .int()
    .positive()
    .max(50),
  default_players_per_side: z.coerce
    .number({ invalid_type_error: "Enter a number" })
    .int()
    .min(2)
    .max(15),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  venue: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  cat1_overs: z.array(z.number().int().positive()),
  cat3_overs: z.array(z.number().int().positive()),
});

type FormValues = z.infer<typeof schema>;

export function NewTournamentForm() {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      format: "league",
      default_overs_per_innings: 6,
      default_players_per_side: 6,
      start_date: "",
      end_date: "",
      venue: "",
      description: "",
      // Seed with the HVC default so brand-new tournaments behave
      // like the original baked-in mapping (over 1 = Cat 1, over 2
      // = Cat 3). The organiser can clear / re-arrange from here.
      cat1_overs: [1],
      cat3_overs: [2],
    },
  });
  const overs = form.watch("default_overs_per_innings");
  const cat1Overs = form.watch("cat1_overs");
  const cat3Overs = form.watch("cat3_overs");

  const onSubmit = async (values: FormValues) => {
    const result = await createTournament(values);
    if (result && !result.ok) {
      toast.error(result.error);
    }
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
                <Input placeholder="Spring Box-Cricket Cup 2026" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
        <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Category overs</div>
            <p className="text-[11px] text-muted-foreground">
              Default Cat 1 / Cat 3 schedule for every match. A single
              match can override later via its edit form.
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
        <FormField
          control={form.control}
          name="venue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Venue</FormLabel>
              <FormControl>
                <Input placeholder="HVC Box, Bengaluru" {...field} />
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
                  placeholder="A short note about this tournament…"
                  className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                />
              </FormControl>
              <FormDescription>Optional. Markdown not rendered yet.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Creating…" : "Create tournament"}
        </Button>
      </form>
    </Form>
  );
}
