"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, getInitials } from "@/lib/utils";

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
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
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
          render={({ field }) => {
            const selected = users.find((u) => u.id === field.value);
            return (
              <FormItem>
                <FormLabel>User</FormLabel>
                <Popover
                  open={userPopoverOpen}
                  onOpenChange={setUserPopoverOpen}
                >
                  <PopoverTrigger
                    render={(props) => (
                      <Button
                        {...props}
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={userPopoverOpen}
                        className={cn(
                          "w-full justify-between capitalize",
                          !selected && "text-muted-foreground",
                        )}
                      >
                        {selected ? (
                          <UserOptionLabel user={selected} />
                        ) : (
                          <span>Pick a user…</span>
                        )}
                        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                      </Button>
                    )}
                  />
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                  >
                    <Command
                      // cmdk de-dupes items by `value`, so suffix it
                      // with the id (two users with the same display
                      // name would otherwise collapse). The custom
                      // filter strips the trailing id token before
                      // matching so multi-word names stay searchable.
                      filter={(value, search) => {
                        const lastSpace = value.lastIndexOf(" ");
                        const name =
                          lastSpace >= 0 ? value.slice(0, lastSpace) : value;
                        return name
                          .toLowerCase()
                          .includes(search.toLowerCase())
                          ? 1
                          : 0;
                      }}
                    >
                      <CommandInput placeholder="Search users…" />
                      <CommandList>
                        <CommandEmpty>No user found.</CommandEmpty>
                        <CommandGroup>
                          {users.map((u) => (
                            <CommandItem
                              key={u.id}
                              value={`${u.display_name} ${u.id}`}
                              onSelect={() => {
                                field.onChange(u.id);
                                setUserPopoverOpen(false);
                              }}
                              className="capitalize"
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  field.value === u.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <UserOptionLabel user={u} />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            );
          }}
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
 * Avatar + display name row used inside the combobox option and
 * inside the trigger button when a user is picked. Renders an
 * initials chip when the user has no avatar uploaded so each option
 * is still visually distinct.
 */
function UserOptionLabel({ user }: { user: UserOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
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
      <span className="truncate">{user.display_name}</span>
    </span>
  );
}
