"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { LogoUploader } from "@/components/logo-uploader";
import { Button } from "@/components/ui/button";
import {
  isValidIndianPhone,
  PHONE_MAX_LENGTH,
  stripPhoneInput,
} from "@/lib/phone";
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

import { updateProfile } from "./actions";

const battingStyles = ["right_hand", "left_hand"] as const;
const bowlingStyles = [
  "right_arm_fast",
  "right_arm_medium",
  "right_arm_off_spin",
  "right_arm_leg_spin",
  "left_arm_fast",
  "left_arm_medium",
  "left_arm_orthodox",
  "left_arm_chinaman",
] as const;

const schema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  avatar_url: z
    .string()
    .url("Avatar URL must be a valid URL")
    .optional()
    .or(z.literal("")),
  category: z.enum(["", "1", "2", "3"]).optional(),
  phone: z
    .string()
    .max(PHONE_MAX_LENGTH, "Phone is too long")
    .refine(
      (v) => isValidIndianPhone(v ?? ""),
      "Enter a valid Indian mobile (10 digits starting 6-9)",
    )
    .optional(),
  batting_style: z.enum(["", ...battingStyles]).optional(),
  bowling_style: z.enum(["", ...bowlingStyles]).optional(),
});

type FormValues = z.infer<typeof schema>;

export type PlayerFieldsInitial = {
  category: number | null;
  phone: string | null;
  batting_style: string | null;
  bowling_style: string | null;
};

/**
 * Inline edit form for the /me profile. Two always-shown fields —
 * display name + avatar URL — plus, when the viewer is linked to a
 * player, a Player block:
 *
 *   - Phone: always editable by the linked user themselves.
 *   - Category / Batting / Bowling: super-admin only (gated server-
 *     side too — `canEditAdminFields` only hides the UI).
 *
 * Hidden by default — parent renders an "Edit" button that flips a
 * useState bool. Keeps the read view clean.
 */
export function EditProfileForm({
  initial,
  player,
  canEditAdminFields,
  onCancel,
}: {
  initial: { display_name: string; avatar_url: string };
  /** When provided, the user has a linked player row; the form
   *  renders the player block. Phone is editable for anyone with a
   *  link; the admin fields below it are gated separately. */
  player: PlayerFieldsInitial | null;
  /** True when the viewer is a super-admin — exposes category +
   *  batting + bowling. Server re-checks the same flag. */
  canEditAdminFields: boolean;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: initial.display_name,
      avatar_url: initial.avatar_url,
      category: (player?.category
        ? String(player.category)
        : "") as FormValues["category"],
      phone: player?.phone ?? "",
      batting_style:
        (player?.batting_style as FormValues["batting_style"]) ?? "",
      bowling_style:
        (player?.bowling_style as FormValues["bowling_style"]) ?? "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    setPending(true);
    const res = await updateProfile({
      display_name: values.display_name,
      avatar_url: values.avatar_url ?? "",
      // Phone goes through whenever the user has a linked player.
      // Admin fields only when the viewer is a super-admin — keeps
      // accidental over-posting from the client honest.
      ...(player ? { phone: values.phone ?? "" } : {}),
      ...(player && canEditAdminFields
        ? {
            category: values.category ?? "",
            batting_style: values.batting_style ?? "",
            bowling_style: values.bowling_style ?? "",
          }
        : {}),
    });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Profile updated");
    onCancel();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="display_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input placeholder="Your name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="avatar_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Profile photo</FormLabel>
              <FormControl>
                <LogoUploader
                  bucket="user-avatars"
                  shape="circle"
                  value={field.value || null}
                  onChange={(url) => field.onChange(url ?? "")}
                  disabled={pending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {player && (
          <div className="space-y-3 rounded-md border border-foreground/10 bg-muted/20 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Player profile
            </div>
            {canEditAdminFields && (
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
            )}
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
            {canEditAdminFields && (
              <div className="grid grid-cols-2 gap-3">
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
            )}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
