"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LogoUploader } from "@/components/logo-uploader";
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
import {
  isValidIndianPhone,
  PHONE_MAX_LENGTH,
  stripPhoneInput,
} from "@/lib/phone";
import { cn } from "@/lib/utils";

import { deletePlayer, updatePlayer } from "../../actions";

const schema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  category: z.enum(["1", "2", "3"], {
    errorMap: () => ({ message: "Pick a category" }),
  }),
  phone: z
    .string()
    .max(PHONE_MAX_LENGTH, "Phone is too long")
    .refine(
      (v) => isValidIndianPhone(v),
      "Enter a valid Indian mobile (10 digits starting 6-9)",
    )
    .optional()
    .or(z.literal("")),
  batting_style: z.enum(["", "right_hand", "left_hand"]).optional(),
  bowling_style: z
    .enum([
      "",
      "right_arm_fast",
      "right_arm_medium",
      "right_arm_off_spin",
      "right_arm_leg_spin",
      "left_arm_fast",
      "left_arm_medium",
      "left_arm_orthodox",
      "left_arm_chinaman",
    ])
    .optional(),
  linked_email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || z.string().email().safeParse(v).success,
      { message: "Enter a valid email" },
    ),
  photo_url: z.string().url().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

type LinkableUser = {
  id: string;
  email: string;
  display_name: string;
};

type Props = {
  player: {
    id: string;
    display_name: string;
    category: 1 | 2 | 3 | null;
    phone: string | null;
    batting_style: string | null;
    bowling_style: string | null;
    linked_email: string | null;
    photo_url: string | null;
  };
  canDelete: boolean;
  linkableUsers: LinkableUser[];
};

export function EditPlayerForm({ player, canDelete, linkableUsers }: Props) {
  const [deleting, startDelete] = useTransition();
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: player.display_name,
      category: (player.category
        ? String(player.category)
        : "") as unknown as FormValues["category"],
      phone: player.phone ?? "",
      batting_style: (player.batting_style as FormValues["batting_style"]) ?? "",
      bowling_style: (player.bowling_style as FormValues["bowling_style"]) ?? "",
      linked_email: player.linked_email ?? "",
      photo_url: player.photo_url ?? null,
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await updatePlayer({
      playerId: player.id,
      ...values,
      category: Number(values.category),
    });
    if (result && !result.ok) {
      toast.error(result.error);
    }
  };

  const onDelete = () => {
    startDelete(async () => {
      const result = await deletePlayer({ playerId: player.id });
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
          name="display_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category…" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="1">Category 1</SelectItem>
                  <SelectItem value="2">Category 2</SelectItem>
                  <SelectItem value="3">Category 3</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                Drives bowling-order rules in HVC matches.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  maxLength={PHONE_MAX_LENGTH}
                  placeholder="98765 43210"
                  {...field}
                  onChange={(e) =>
                    field.onChange(stripPhoneInput(e.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="linked_email"
          render={({ field }) => {
            const selected = linkableUsers.find((u) => u.email === field.value);
            return (
              <FormItem>
                <FormLabel>Linked user account (optional)</FormLabel>
                <Popover
                  open={linkPopoverOpen}
                  onOpenChange={setLinkPopoverOpen}
                >
                  <PopoverTrigger
                    render={(props) => (
                      <Button
                        {...props}
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={linkPopoverOpen}
                        className={cn(
                          "w-full justify-between capitalize",
                          !selected && "text-muted-foreground",
                        )}
                      >
                        {selected ? (
                          <span className="flex min-w-0 flex-col items-start">
                            <span className="truncate">
                              {selected.display_name}
                            </span>
                            <span className="font-mono text-[10px] normal-case text-muted-foreground">
                              {selected.email}
                            </span>
                          </span>
                        ) : (
                          <span>Not linked</span>
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
                      // cmdk filters on `value`. Stash both display
                      // name + email into the value so typing either
                      // matches the same row. The id is suffixed so
                      // two users sharing a display name don't
                      // collapse — strip the trailing id token before
                      // the substring match.
                      filter={(value, search) => {
                        const lastSpace = value.lastIndexOf(" ");
                        const haystack =
                          lastSpace >= 0 ? value.slice(0, lastSpace) : value;
                        return haystack
                          .toLowerCase()
                          .includes(search.toLowerCase())
                          ? 1
                          : 0;
                      }}
                    >
                      <CommandInput placeholder="Search by name or email…" />
                      <CommandList>
                        <CommandEmpty>No user found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__none__"
                            onSelect={() => {
                              field.onChange("");
                              setLinkPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 size-4",
                                !field.value ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="text-muted-foreground">
                              Not linked
                            </span>
                          </CommandItem>
                          {linkableUsers.map((u) => (
                            <CommandItem
                              key={u.id}
                              value={`${u.display_name} ${u.email} ${u.id}`}
                              onSelect={() => {
                                field.onChange(u.email);
                                setLinkPopoverOpen(false);
                              }}
                              className="capitalize"
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  field.value === u.email
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate">
                                  {u.display_name}
                                </span>
                                <span className="font-mono text-[10px] normal-case text-muted-foreground">
                                  {u.email}
                                </span>
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormDescription>
                  Pick the auth account this player record represents. Pick
                  &ldquo;Not linked&rdquo; to unlink an existing link.
                </FormDescription>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="batting_style"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Batting</FormLabel>
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="right_hand">Right hand</SelectItem>
                    <SelectItem value="left_hand">Left hand</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="bowling_style"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bowling</FormLabel>
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="right_arm_fast">
                      Right arm fast
                    </SelectItem>
                    <SelectItem value="right_arm_medium">
                      Right arm medium
                    </SelectItem>
                    <SelectItem value="right_arm_off_spin">
                      Right arm off-spin
                    </SelectItem>
                    <SelectItem value="right_arm_leg_spin">
                      Right arm leg-spin
                    </SelectItem>
                    <SelectItem value="left_arm_fast">
                      Left arm fast
                    </SelectItem>
                    <SelectItem value="left_arm_medium">
                      Left arm medium
                    </SelectItem>
                    <SelectItem value="left_arm_orthodox">
                      Left arm orthodox
                    </SelectItem>
                    <SelectItem value="left_arm_chinaman">
                      Left arm chinaman
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="photo_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Photo</FormLabel>
              <FormControl>
                <LogoUploader
                  bucket="player-photos"
                  value={field.value ?? null}
                  onChange={field.onChange}
                  shape="circle"
                />
              </FormControl>
              <FormDescription>PNG or JPG, up to 2 MB.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex items-center justify-between gap-2 border-t border-foreground/10 pt-4">
          {canDelete ? (
            <ConfirmButton
              title={`Delete "${player.display_name}"?`}
              description="This only works if they're not on any squad or in any match."
              confirmLabel="Delete player"
              destructive
              onConfirm={onDelete}
              triggerProps={{
                type: "button",
                variant: "ghost",
                className: "text-destructive hover:text-destructive",
                disabled: deleting || form.formState.isSubmitting,
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </ConfirmButton>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Link href={`/players/${player.id}`} prefetch>
              <Button
                type="button"
                variant="ghost"
                disabled={deleting || form.formState.isSubmitting}
              >
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || deleting}
            >
              {form.formState.isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
