import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

export function IpadSidebarActions(
  props: {
    readonly onSelect?: (tab: WorkspaceTab | "settings") => void;
    readonly selectedDestination?: Exclude<WorkspaceTab, "threads"> | "settings" | null;
  } = {},
) {
  const workspace = useWorkspaceTabs();
  const selectTab = useSelectWorkspaceTab();
  const insets = useSafeAreaInsets();
  const selected =
    props.selectedDestination !== undefined
      ? props.selectedDestination
      : workspace?.settingsOpen
        ? "settings"
        : workspace?.state.selectedTab;
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  return (
    <IpadSidebarActionRows
      key={landscape ? "landscape" : "portrait"}
      initiallyExpanded={!landscape}
      selected={selected}
      onSelect={props.onSelect ?? selectTab}
      bottomInset={insets.bottom}
    />
  );
}

function IpadSidebarActionRows(props: {
  readonly initiallyExpanded: boolean;
  readonly selected: WorkspaceTab | "settings" | null | undefined;
  readonly onSelect: (tab: WorkspaceTab | "settings") => void;
  readonly bottomInset: number;
}) {
  const [expanded, setExpanded] = useState(props.initiallyExpanded);
  const actions = [
    { tab: "pullRequests", label: "Pull requests", icon: PullRequestGlyph.pullRequest },
    { tab: "usage", label: "Usage", icon: "chart.bar.xaxis" },
  ] as const;
  const settingsSelected = props.selected === "settings";
  const outerSpacing = Math.max(12, props.bottomInset);
  return (
    <View
      pointerEvents="box-none"
      className="shrink-0 pt-2"
      style={{ paddingHorizontal: outerSpacing, paddingBottom: outerSpacing }}
    >
      <View className="gap-1 rounded-xl border border-border-subtle bg-card p-1">
        {expanded
          ? actions.map((action) => (
              <Pressable
                key={action.tab}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ selected: props.selected === action.tab }}
                onPress={() => props.onSelect(action.tab)}
                style={{ minHeight: 44 }}
                className={`flex-row items-center gap-3 rounded-lg px-3 py-2 ${props.selected === action.tab ? "bg-thread-selected" : "active:bg-thread-hover"}`}
              >
                <SymbolView
                  name={action.icon}
                  size={20}
                  tintColorClassName={
                    props.selected === action.tab
                      ? "accent-thread-selected-foreground"
                      : "accent-drawer-foreground-muted"
                  }
                />
                <AppText
                  className={`font-t3-medium text-base ${props.selected === action.tab ? "text-thread-selected-foreground" : "text-drawer-foreground"}`}
                >
                  {action.label}
                </AppText>
              </Pressable>
            ))
          : null}
        {expanded ? <View className="mx-3 h-px bg-border-subtle" /> : null}
        <View
          className={`flex-row items-center rounded-lg ${settingsSelected ? "bg-thread-selected" : ""}`}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            accessibilityState={{ selected: settingsSelected }}
            onPress={() => props.onSelect("settings")}
            style={{ minHeight: 44 }}
            className="flex-1 flex-row items-center gap-3 rounded-lg px-3 py-2 active:bg-thread-hover"
          >
            <SymbolView
              name="gearshape"
              size={20}
              tintColorClassName={
                settingsSelected
                  ? "accent-thread-selected-foreground"
                  : "accent-drawer-foreground-muted"
              }
            />
            <AppText
              className={`font-t3-medium text-base ${settingsSelected ? "text-thread-selected-foreground" : "text-drawer-foreground"}`}
            >
              Settings
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Collapse sidebar items" : "Expand sidebar items"}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{ minWidth: 44, minHeight: 44 }}
            className="items-center justify-center rounded-lg active:bg-thread-hover"
          >
            <SymbolView
              name={expanded ? "chevron.down" : "chevron.up"}
              size={14}
              tintColorClassName={
                settingsSelected
                  ? "accent-thread-selected-foreground"
                  : "accent-drawer-foreground-muted"
              }
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
