"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createPlayer } from "../actions";

const schema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  category: z.enum(["1", "2", "3"], {
    errorMap: () => ({ message: "Pick a category" }),
  }),
  phone: z.string().optional().or(z.literal("")),
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
});

type FormValues = z.infer<typeof schema>;

export type LinkableUser = {
  id: string;
  email: string;
  display_name: string;
};

export function NewPlayerForm({
  redirectTo,
  linkableUsers,
}: {
  redirectTo?: string;
  linkableUsers: LinkableUser[];
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: "",
      category: "" as unknown as FormValues["category"],
      phone: "",
      batting_style: "",
      bowling_style: "",
      linked_email: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await createPlayer({
      ...values,
      category: Number(values.category),
      redirectTo,
    });
    if (result && !result.ok) {
      toast.error(result.error);
    }
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
                <Input placeholder="Virat K." {...field} />
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
                HVC: Cat 1 bowls over 1 vs Cat 1 batter, Cat 3 bowls over 2 vs
                Cat 3 batter, Cat 2 bowls the rest. Max 2 overs per bowler.
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
                <Input type="tel" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="linked_email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Linked user account (optional)</FormLabel>
              <Select
                value={field.value || "__none__"}
                onValueChange={(v) =>
                  field.onChange(v === "__none__" ? "" : v)
                }
              >
                <FormControl>
                  <SelectTrigger className="capitalize">
                    <SelectValue placeholder="Not linked" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">
                      Not linked
                    </span>
                  </SelectItem>
                  {linkableUsers.map((u) => (
                    <SelectItem
                      key={u.id}
                      value={u.email}
                      className="capitalize"
                    >
                      <span className="flex flex-col">
                        <span>{u.display_name}</span>
                        <span className="font-mono text-[10px] normal-case text-muted-foreground">
                          {u.email}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                If this player has signed up to the app (e.g. an organizer or
                scorer who also plays), pick their account here to link the
                records. {linkableUsers.length} registered user
                {linkableUsers.length === 1 ? "" : "s"} available.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
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
        <div className="flex items-center justify-end gap-2 border-t border-foreground/10 pt-4">
          <Link href={redirectTo ?? "/players"} prefetch>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create player"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
