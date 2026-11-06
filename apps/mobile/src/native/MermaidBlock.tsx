// Fork: Embed offline diagrams in native Markdown image slots until upstream supports Mermaid code blocks.
import { memo, useMemo, useState, type ReactNode } from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import script from "@t3tools/mobile-mermaid-stream";
import { ControlPill } from "../components/ui/ControlPill";
import { AppText } from "../components/ui/AppText";
import { IconButton } from "../components/ui/IconButton";
import { usePreviewPresentation } from "../lib/previewPresentation";
import { mermaidDocument, mermaidMessage } from "../features/mermaid/mermaid-document";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

export const MermaidBlock = memo(function MermaidBlock(props: {
  source: string;
  dark: boolean;
  children: ReactNode;
}) {
  const { themeVariables } = useAppearancePreferences();
  const [showSource, setShowSource] = useState(false);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(160);
  const [expanded, setExpanded] = useState(false);
  const sourceVisible = showSource || failed;
  const colors = useMemo(
    () => ({
      "--pele-bg": themeVariables["--color-screen"],
      "--pele-fg": themeVariables["--color-foreground"],
      "--pele-muted": themeVariables["--color-foreground-muted"],
      "--pele-line": themeVariables["--color-foreground-muted"],
      "--pele-surface": themeVariables["--color-subtle"],
      "--pele-surface-alt": themeVariables["--color-subtle-strong"],
      "--pele-border": themeVariables["--color-border"],
      "--pele-accent": themeVariables["--color-primary"],
      "--pele-critical": themeVariables["--color-danger-foreground"],
    }),
    [themeVariables],
  );
  const document = useMemo(
    () => ({ html: mermaidDocument(props.source, props.dark, colors, script) }),
    [props.source, props.dark, colors],
  );
  return (
    <View style={{ minWidth: 0, marginBottom: 12 }}>
      <View className="flex-row justify-end gap-1 pb-1">
        {!sourceVisible ? (
          <ControlPill
            variant="pill"
            icon="arrow.up.left.and.arrow.down.right"
            label="Expand"
            accessibilityLabel="Expand diagram"
            onPress={() => setExpanded(true)}
          />
        ) : null}
        <ControlPill
          variant="pill"
          label={sourceVisible ? "Show diagram" : "Show source"}
          onPress={() => {
            setShowSource(!sourceVisible);
            setFailed(false);
          }}
        />
      </View>
      {failed ? (
        <AppText className="text-xs text-foreground-muted">Diagram could not be rendered.</AppText>
      ) : null}
      {sourceVisible ? (
        props.children
      ) : (
        <WebView
          source={document}
          // Fork: Markdown slots reserve intrinsic height; WebView's default flex wrapper can retain a short viewport until upstream handles embedded sizing.
          containerStyle={{ height, flex: 0 }}
          originWhitelist={["*"]}
          scrollEnabled={false}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          onMessage={({ nativeEvent }) => {
            const message = mermaidMessage(nativeEvent.data);
            if (message?.type === "error") setFailed(true);
            if (message?.type === "height") setHeight(message.height);
          }}
          onError={() => setFailed(true)}
          onContentProcessDidTerminate={() => setFailed(true)}
          onRenderProcessGone={() => setFailed(true)}
          style={{ height, flex: 0, backgroundColor: "transparent" }}
        />
      )}
      {expanded ? (
        <ExpandedMermaidDiagram
          source={props.source}
          dark={props.dark}
          colors={colors}
          onClose={() => setExpanded(false)}
          onError={() => {
            setExpanded(false);
            setFailed(true);
          }}
        />
      ) : null}
    </View>
  );
});

// Fork: Full-screen diagrams stay local and zoomable until upstream provides a native Mermaid viewer.
function ExpandedMermaidDiagram(props: {
  readonly source: string;
  readonly dark: boolean;
  readonly colors: Record<string, string>;
  readonly onClose: () => void;
  readonly onError: () => void;
}) {
  const insets = useSafeAreaInsets();
  usePreviewPresentation(props.source, props.onClose);
  const document = useMemo(
    () => ({ html: mermaidDocument(props.source, props.dark, props.colors, script, true) }),
    [props.source, props.dark, props.colors],
  );
  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={props.onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        className="flex-1 bg-screen"
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
        <View className="min-h-14 flex-row items-center justify-between px-3">
          <AppText className="text-base font-t3-medium text-foreground">Mermaid diagram</AppText>
          <IconButton icon="xmark" accessibilityLabel="Close diagram" onPress={props.onClose} />
        </View>
        <WebView
          source={document}
          originWhitelist={["*"]}
          scrollEnabled={false}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          onMessage={({ nativeEvent }) => {
            if (mermaidMessage(nativeEvent.data)?.type === "error") props.onError();
          }}
          onError={props.onError}
          onContentProcessDidTerminate={props.onError}
          onRenderProcessGone={props.onError}
          style={{ flex: 1, backgroundColor: "transparent" }}
        />
      </View>
    </Modal>
  );
}
