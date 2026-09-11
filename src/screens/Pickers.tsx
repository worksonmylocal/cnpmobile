import { View } from "react-native";
import { Plan, productCode, productName } from "../nav";
import { Empty, PickList, Spinner } from "../ui";
import { useLoad } from "../useLoad";

/** Shared wrapper: spinner, server error, then the searchable list. */
function Picker<T>({
  method, args, deps, ...rest
}: {
  method: string;
  args?: object;
  deps?: unknown[];
} & Omit<React.ComponentProps<typeof PickList<T>>, "items">) {
  const { data, error, loading } = useLoad<T[]>(method, args, deps);
  if (loading) return <Spinner />;
  if (error) return <Empty>{error}</Empty>;
  return <PickList<T> items={data ?? []} {...rest} />;
}

type Section = { name: string; section_name?: string };
export function PickSection({ onSelect }: { onSelect: (sectionName: string) => void }) {
  return (
    <Picker<Section>
      method="get_all_sections"
      placeholder="Search sections…"
      emptyText="No sections found."
      getLabel={(s) => s.section_name || s.name}
      getKey={(s) => s.name}
      onSelect={(s) => onSelect(s.name)}
    />
  );
}

type BlockRow = { name: string };
export function PickBlock({
  section, onSelect,
}: { section: string; onSelect: (block: string) => void }) {
  return (
    <Picker<BlockRow>
      method="get_blocks_in_section"
      args={{ section }}
      placeholder="Search blocks…"
      emptyText="No blocks in this section."
      getLabel={(b) => b.name}
      getKey={(b) => b.name}
      onSelect={(b) => onSelect(b.name)}
    />
  );
}

type Employee = { name: string; employee_name: string };
export function AddEmployee({ onSelect }: { onSelect: (employee: string) => void }) {
  return (
    <Picker<Employee>
      method="get_available_employees_for_team"
      placeholder="Search employees by name…"
      emptyText="No available employees to add right now."
      getLabel={(e) => e.employee_name}
      getKey={(e) => e.name}
      onSelect={(e) => onSelect(e.name)}
    />
  );
}

type IssuedSection = { section: string; pending_count: number };
export function RecordSection({ onSelect }: { onSelect: (section: string) => void }) {
  return (
    <Picker<IssuedSection>
      method="get_sections_with_issued_work"
      placeholder="Search sections…"
      emptyText="No blocks are ready to record yet — fertilizer must be issued from store first."
      getLabel={(s) => s.section}
      getSub={(s) => `${s.pending_count} block${s.pending_count === 1 ? "" : "s"} ready to record`}
      getKey={(s) => s.section}
      onSelect={(s) => onSelect(s.section)}
    />
  );
}

type IssuedBlock = { block: string };
export function RecordBlock({
  section, onSelect,
}: { section: string; onSelect: (block: string) => void }) {
  return (
    <Picker<IssuedBlock>
      method="get_issued_blocks_in_section"
      args={{ section }}
      placeholder="Search blocks…"
      emptyText="No issued blocks in this section."
      getLabel={(b) => b.block}
      getKey={(b) => b.block}
      onSelect={(b) => onSelect(b.block)}
    />
  );
}

/** Already-loaded plans, so this one is a plain list rather than a fetch. */
export function RecordPlans({
  plans, onSelect,
}: { plans: Plan[]; onSelect: (p: Plan) => void }) {
  return (
    <View>
      <PickList<Plan>
        items={plans}
        placeholder="Search products…"
        emptyText="Nothing to record on this block."
        getLabel={(p) => productName(p)}
        getSub={(p) => `${productCode(p)} · ${p.application_month} · ${p.total_kg_required} Kg`}
        getKey={(p) => p.name}
        onSelect={onSelect}
      />
    </View>
  );
}
