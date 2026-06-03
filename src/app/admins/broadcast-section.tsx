"use client";

import { Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { broadcastToTournament } from "./actions";

export type TournamentChoice = {
  id: string;
  name: string;
  /** Subscriber count for this tournament so the organiser knows how
   *  many devices the broadcast will reach BEFORE they hit send. */
  subscribers: number;
};

const TITLE_MAX = 80;
const BODY_MAX = 240;

export function BroadcastSection({
  tournaments,
}: {
  tournaments: TournamentChoice[];
}) {
  const [tournamentId, setTournamentId] = useState<string>(
    tournaments[0]?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const selected = tournaments.find((t) => t.id === tournamentId);
  const canSend =
    tournamentId.length > 0 &&
    title.trim().length >= 2 &&
    body.trim().length >= 2 &&
    !pending;

  const onSend = () => {
    startTransition(async () => {
      const res = await broadcastToTournament({
        tournament_id: tournamentId,
        title: title.trim(),
        body: body.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { sent, pruned } = res.data;
      const prunedSuffix =
        pruned > 0 ? ` · ${pruned} dead subscription${pruned === 1 ? "" : "s"} cleared` : "";
      toast.success(
        `Sent to ${sent} device${sent === 1 ? "" : "s"}${prunedSuffix}`,
      );
      setTitle("");
      setBody("");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Broadcast</CardTitle>
        <CardDescription>
          Push a one-shot notification to every device subscribed to
          any match in the selected tournament. De-duplicated by
          endpoint so a user subscribed to multiple matches in the
          same tournament gets one ping, not many.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tournament
          </label>
          {tournaments.length === 0 ? (
            <p className="rounded-md border border-foreground/10 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              No tournaments yet.
            </p>
          ) : (
            <Select value={tournamentId} onValueChange={setTournamentId}>
              <SelectTrigger className="capitalize">
                <SelectValue placeholder="Pick a tournament…" />
              </SelectTrigger>
              <SelectContent>
                {tournaments.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="capitalize">
                    {t.name} ·{" "}
                    <span className="font-mono text-[10px]">
                      {t.subscribers} subscriber{t.subscribers === 1 ? "" : "s"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selected && selected.subscribers === 0 && (
            <p className="text-[11px] text-muted-foreground">
              This tournament has no push subscribers yet. Send will
              return &quot;Sent to 0 devices&quot;.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="broadcast-title"
            className="flex items-baseline justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span>Title</span>
            <span className="font-mono text-[10px]">
              {title.length} / {TITLE_MAX}
            </span>
          </label>
          <Input
            id="broadcast-title"
            value={title}
            maxLength={TITLE_MAX}
            placeholder="Quarterfinal in 30 min"
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="broadcast-body"
            className="flex items-baseline justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span>Message</span>
            <span className="font-mono text-[10px]">
              {body.length} / {BODY_MAX}
            </span>
          </label>
          <textarea
            id="broadcast-body"
            value={body}
            maxLength={BODY_MAX}
            rows={3}
            placeholder="See you at the ground."
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={onSend} disabled={!canSend}>
            {pending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 size-4" />
            )}
            {pending ? "Sending…" : "Send broadcast"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
