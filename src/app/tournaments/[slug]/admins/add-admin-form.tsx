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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { addAdmin } from "./actions";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  role: z.enum(["organizer", "scorer"]),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  tournamentSlug: string;
  allowOrganizer: boolean;
};

export function AddAdminForm({ tournamentSlug, allowOrganizer }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "scorer" },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await addAdmin({ tournamentSlug, ...values });
    if (result && !result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Admin added");
    form.reset({ email: "", role: "scorer" });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="user@example.com"
                  {...field}
                />
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
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="scorer">Scorer</SelectItem>
                  {allowOrganizer && (
                    <SelectItem value="organizer">Organizer</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Adding…" : "Add admin"}
        </Button>
      </form>
    </Form>
  );
}
