"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { LogoUploader } from "@/components/logo-uploader";
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

import { updateProfile } from "./actions";

const schema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  avatar_url: z
    .string()
    .url("Avatar URL must be a valid URL")
    .optional()
    .or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

/**
 * Inline edit form for the /me profile. Two fields — display name and
 * avatar URL — wrapped in a "Save" / "Cancel" pair so the user has to
 * commit explicitly. Display name is required; avatar URL is optional.
 *
 * Hidden by default — parent renders an "Edit" button that flips a
 * useState bool. Keeps the read view clean.
 */
export function EditProfileForm({
  initial,
  onCancel,
}: {
  initial: { display_name: string; avatar_url: string };
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: initial.display_name,
      avatar_url: initial.avatar_url,
    },
  });

  const onSubmit = async (values: FormValues) => {
    setPending(true);
    const res = await updateProfile({
      display_name: values.display_name,
      avatar_url: values.avatar_url ?? "",
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
