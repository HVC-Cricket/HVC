"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
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

import { deletePlayer, updatePlayer } from "../../actions";

const schema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
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
});

type FormValues = z.infer<typeof schema>;

type Props = {
  player: {
    id: string;
    display_name: string;
    phone: string | null;
    batting_style: string | null;
    bowling_style: string | null;
  };
  canDelete: boolean;
};

export function EditPlayerForm({ player, canDelete }: Props) {
  const [deleting, startDelete] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: player.display_name,
      phone: player.phone ?? "",
      batting_style: (player.batting_style as FormValues["batting_style"]) ?? "",
      bowling_style: (player.bowling_style as FormValues["bowling_style"]) ?? "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    const result = await updatePlayer({ playerId: player.id, ...values });
    if (result && !result.ok) {
      toast.error(result.error);
    }
  };

  const onDelete = () => {
    if (
      !window.confirm(
        `Delete player "${player.display_name}"? This only works if they're not on any roster or in any match.`,
      )
    ) {
      return;
    }
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
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="batting_style"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Batting</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="">—</option>
                    <option value="right_hand">Right hand</option>
                    <option value="left_hand">Left hand</option>
                  </select>
                </FormControl>
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
                <FormControl>
                  <select
                    {...field}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="">—</option>
                    <option value="right_arm_fast">Right arm fast</option>
                    <option value="right_arm_medium">Right arm medium</option>
                    <option value="right_arm_off_spin">Right arm off-spin</option>
                    <option value="right_arm_leg_spin">Right arm leg-spin</option>
                    <option value="left_arm_fast">Left arm fast</option>
                    <option value="left_arm_medium">Left arm medium</option>
                    <option value="left_arm_orthodox">Left arm orthodox</option>
                    <option value="left_arm_chinaman">Left arm chinaman</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex items-center justify-between gap-4 pt-2">
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={deleting || form.formState.isSubmitting}
              onClick={onDelete}
            >
              {deleting ? "Deleting…" : "Delete player"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Only super admins can delete players.
            </span>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting || deleting}>
            {form.formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
