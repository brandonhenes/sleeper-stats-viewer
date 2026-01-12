import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "lucide-react";

type Props = {
  season?: number;
  seasons: number[];
  onChange: (season: number) => void;
};

export function SeasonSelector({ season, seasons, onChange }: Props) {
  if (!seasons.length) return null;

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <Select
        value={season?.toString() ?? ""}
        onValueChange={(val) => onChange(Number(val))}
      >
        <SelectTrigger className="w-[100px]" data-testid="select-season">
          <SelectValue placeholder="Season" />
        </SelectTrigger>
        <SelectContent>
          {seasons.map((s) => (
            <SelectItem key={s} value={s.toString()} data-testid={`option-season-${s}`}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
