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
import { getInitials } from "@/lib/utils";

import { addAdmin } from "./actions";

const schema = z.object({
  userId: z.string().uuid("Pick a user"),
  role: z.enum(["organizer", "scorer"]),
});

type FormValues = z.infer<typeof schema>;

type UserOption = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type Props = {
  tournamentSlug: string;
  allowOrganizer: boolean;
  users: UserOption[];
};

export function AddAdminForm({ tournamentSlug, allowOrganizer, users }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { userId: "", role: "scorer" },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await addAdmin({ tournamentSlug, ...values });
    if (result && !result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Admin added");
    form.reset({ userId: "", role: "scorer" });
  };

  if (users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No signed-up users left to add. Ask them to{" "}
        <span className="font-medium">sign up</span> first, then refresh this
        page.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="userId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>User</FormLabel>
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="capitalize">
                    <SelectValue placeholder="Pick a user…" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem
                      key={u.id}
                      value={u.id}
                      className="capitalize"
                    >
                      <UserOptionLabel user={u} />
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

/**
 * Avatar + display name row used inside the Select option. Renders an
 * initials chip when the user has no avatar uploaded so each option is
 * still visually distinct.
 */
function UserOptionLabel({ user }: { user: UserOption }) {
  return (
    <span className="flex items-center gap-2">
      {user.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatar_url}
          alt=""
          className="size-5 shrink-0 rounded-full border border-foreground/10 object-cover"
        />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
          {getInitials(user.display_name)}
        </span>
      )}
      <span>{user.display_name}</span>
    </span>
  );
}
