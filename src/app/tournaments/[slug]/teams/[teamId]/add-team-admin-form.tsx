"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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

import { addTeamAdmin } from "../actions";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  tournamentSlug: string;
  teamId: string;
};

export function AddTeamAdminForm({ tournamentSlug, teamId }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await addTeamAdmin({
      tournamentSlug,
      teamId,
      email: values.email,
    });
    if (result && !result.ok) {
      toast.error(result.error);
      return;
    }
    form.reset({ email: "" });
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormLabel className="sr-only">User email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="user@example.com"
                  autoComplete="off"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-[11px]">
                User must have signed up first.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          size="sm"
          disabled={form.formState.isSubmitting}
          className="shrink-0"
        >
          {form.formState.isSubmitting ? "Adding…" : "Add admin"}
        </Button>
      </form>
    </Form>
  );
}
