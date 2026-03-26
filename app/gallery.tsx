import { useState, useCallback, useRef } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Modal,
  Pressable,
  Platform,
  Animated,
  ToastAndroid,
  Alert,
  ActionSheetIOS,
} from "react-native";
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Sharing from "expo-sharing";
import { capturedPhotos } from "./index";

const { width, height } = Dimensions.get("window");
const GRID_PADDING = 2;
const COLS = 3;
const ITEM_SIZE = (width - GRID_PADDING * (COLS + 1)) / COLS;

// ─── Toast ────────────────────────────────────────────────────────────────────

function useToast() {
  const opacity = useRef(new Animated.Value(0)).current;
  const [message, setMessage] = useState("");

  const show = (msg: string) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
      return;
    }
    setMessage(msg);
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(1800),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const ToastComponent = () => (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );

  return { show, ToastComponent };
}

// ─── Share helpers ────────────────────────────────────────────────────────────

async function sharePhoto(uri: string): Promise<boolean> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert(
        "Sharing unavailable",
        "Sharing is not supported on this device.",
      );
      return false;
    }
    await Sharing.shareAsync(uri, {
      mimeType: "image/jpeg",
      dialogTitle: "Share photo",
      UTI: "public.jpeg",
    });
    return true;
  } catch {
    return false;
  }
}

// Share multiple photos sequentially (expo-sharing is one-at-a-time)
async function shareMultiplePhotos(uris: string[]): Promise<void> {
  for (const uri of uris) {
    await sharePhoto(uri);
  }
}

// ─── Upscale via Python backend ───────────────────────────────────────────────

const ENHANCE_URL = "http://192.168.29.180:8000/enhance";

async function upscalePhoto(uri: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", {
    uri,
    name: "photo.jpg",
    type: "image/jpeg",
  } as any);

  const response = await fetch(ENHANCE_URL, {
    method: "POST",
    body: formData,
    headers: { Accept: "image/jpeg" },
  });

  if (!response.ok) throw new Error(`Server error: ${response.status}`);

  const blob = await response.blob();
  const reader = new FileReader();
  const resultBase64: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const outUri = uri + "_upscaled.jpg";
  await FileSystem.writeAsStringAsync(outUri, resultBase64, {
    encoding: "base64",
  });
  return outUri;
}

// ─── Share picker (fullscreen modal) ─────────────────────────────────────────

function showSharePicker(
  hasUpscaled: boolean,
  onOriginal: () => void,
  onUpscaled: () => void,
  onBoth: () => void,
) {
  if (Platform.OS === "ios") {
    const options = hasUpscaled
      ? ["Share Original", "Share Upscaled", "Share Both", "Cancel"]
      : ["Share Original", "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (idx) => {
        if (!hasUpscaled) {
          if (idx === 0) onOriginal();
        } else {
          if (idx === 0) onOriginal();
          else if (idx === 1) onUpscaled();
          else if (idx === 2) onBoth();
        }
      },
    );
  } else {
    // Android: use Alert as a simple picker
    const buttons: any[] = [{ text: "Share Original", onPress: onOriginal }];
    if (hasUpscaled) {
      buttons.push({ text: "Share Upscaled", onPress: onUpscaled });
      buttons.push({ text: "Share Both", onPress: onBoth });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Share Photo", "Choose a version to share:", buttons);
  }
}

// ─── Batch share picker (grid multi-select) ───────────────────────────────────

function showBatchSharePicker(
  count: number,
  onOriginals: () => void,
  onUpscaled: () => void,
) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [
          `Share ${count} Original${count > 1 ? "s" : ""}`,
          `Share ${count} Upscaled (originals if not processed)`,
          "Cancel",
        ],
        cancelButtonIndex: 2,
      },
      (idx) => {
        if (idx === 0) onOriginals();
        else if (idx === 1) onUpscaled();
      },
    );
  } else {
    Alert.alert(
      `Share ${count} Photo${count > 1 ? "s" : ""}`,
      "Choose which versions to share:",
      [
        { text: `Share Original${count > 1 ? "s" : ""}`, onPress: onOriginals },
        {
          text: `Share Upscaled (originals if not processed)`,
          onPress: onUpscaled,
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }
}

// ─── ZoomableImage ────────────────────────────────────────────────────────────

function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const resetZoom = () => {
    "worklet";
    scale.value = withSpring(1);
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedScale.value = 1;
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      if (scale.value <= 1) resetZoom();
      else savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) resetZoom();
      else {
        scale.value = withSpring(3);
        savedScale.value = 3;
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector
      gesture={Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan))}
    >
      <Reanimated.Image
        source={{ uri }}
        style={[styles.fullscreenImage, animStyle]}
        resizeMode="contain"
      />
    </GestureDetector>
  );
}

// ─── GridItem ─────────────────────────────────────────────────────────────────

function GridItem({
  uri,
  index,
  selected,
  selectionMode,
  onPress,
  onLongPress,
}: {
  uri: string;
  index: number;
  selected: boolean;
  selectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handleLongPress = () => {
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.92,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
    onLongPress();
  };

  return (
    <TouchableOpacity
      style={styles.gridItem}
      onPress={onPress}
      onLongPress={handleLongPress}
      delayLongPress={350}
      activeOpacity={0.85}
    >
      <Animated.View style={{ transform: [{ scale }], flex: 1 }}>
        <Reanimated.Image
          source={{ uri }}
          style={styles.gridImage}
          resizeMode="cover"
        />

        {/* Index badge */}
        <View style={styles.gridIndex}>
          <Text style={styles.gridIndexText}>{index + 1}</Text>
        </View>

        {/* Selection overlay */}
        {selectionMode && (
          <View
            style={[
              styles.selectionOverlay,
              selected && styles.selectionOverlayActive,
            ]}
          >
            <View
              style={[
                styles.selectionCircle,
                selected && styles.selectionCircleActive,
              ]}
            >
              {selected && <Text style={styles.selectionCheck}>✓</Text>}
            </View>
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function GalleryScreen() {
  const photos = capturedPhotos;

  // Fullscreen viewer
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isSharingFullscreen, setIsSharingFullscreen] = useState(false);

  // Upscale — keyed by photo index
  const [upscaledUris, setUpscaledUris] = useState<Record<number, string>>({});
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [showingUpscaled, setShowingUpscaled] = useState(false);

  // Multi-select
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(),
  );
  const [isBatchSharing, setIsBatchSharing] = useState(false);

  const { show: showToast, ToastComponent } = useToast();

  // ── Fullscreen helpers ──────────────────────────────────────────────────────

  const openPhoto = (index: number) => {
    setSelectedIndex(index);
    setShowingUpscaled(false);
  };
  const closePhoto = () => {
    setSelectedIndex(null);
    setShowingUpscaled(false);
  };
  const goNext = () => {
    if (selectedIndex !== null && selectedIndex < photos.length - 1)
      openPhoto(selectedIndex + 1);
  };
  const goPrev = () => {
    if (selectedIndex !== null && selectedIndex > 0)
      openPhoto(selectedIndex - 1);
  };

  // ── Fullscreen share (with picker) ─────────────────────────────────────────

  const handleFullscreenShare = () => {
    if (selectedIndex === null) return;
    const upscaledUri = upscaledUris[selectedIndex] ?? null;

    showSharePicker(
      !!upscaledUri,
      async () => {
        setIsSharingFullscreen(true);
        await sharePhoto(photos[selectedIndex]);
        setIsSharingFullscreen(false);
      },
      async () => {
        setIsSharingFullscreen(true);
        await sharePhoto(upscaledUri!);
        setIsSharingFullscreen(false);
      },
      async () => {
        setIsSharingFullscreen(true);
        await sharePhoto(photos[selectedIndex]);
        await sharePhoto(upscaledUri!);
        setIsSharingFullscreen(false);
      },
    );
  };

  // ── Upscale ────────────────────────────────────────────────────────────────

  const handleUpscale = async () => {
    if (selectedIndex === null) return;
    const existing = upscaledUris[selectedIndex];

    if (existing) {
      setShowingUpscaled((prev) => !prev);
      return;
    }

    setIsUpscaling(true);
    try {
      const result = await upscalePhoto(photos[selectedIndex]);
      setUpscaledUris((prev) => ({ ...prev, [selectedIndex]: result }));
      setShowingUpscaled(true);
      showToast("Upscale done — tap ⇄ to compare");
    } catch (e) {
      console.error("Upscale failed:", e);
      showToast("Upscale failed");
    } finally {
      setIsUpscaling(false);
    }
  };

  // ── Multi-select ───────────────────────────────────────────────────────────

  const enterSelectionMode = (index: number) => {
    setSelectionMode(true);
    setSelectedIndices(new Set([index]));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIndices(new Set());
  };

  const toggleSelection = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleGridPress = (index: number) => {
    if (selectionMode) {
      toggleSelection(index);
    } else {
      openPhoto(index);
    }
  };

  const handleGridLongPress = (index: number) => {
    if (selectionMode) {
      toggleSelection(index);
    } else {
      enterSelectionMode(index);
    }
  };

  // ── Batch share ────────────────────────────────────────────────────────────

  const handleBatchShare = () => {
    const count = selectedIndices.size;
    if (count === 0) return;

    showBatchSharePicker(
      count,
      // Share originals
      async () => {
        setIsBatchSharing(true);
        const uris = [...selectedIndices].map((i) => photos[i]);
        await shareMultiplePhotos(uris);
        setIsBatchSharing(false);
        exitSelectionMode();
      },
      // Share upscaled (fall back to original if not processed)
      async () => {
        setIsBatchSharing(true);
        const uris = [...selectedIndices].map(
          (i) => upscaledUris[i] ?? photos[i],
        );
        await shareMultiplePhotos(uris);
        setIsBatchSharing(false);
        exitSelectionMode();
      },
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item, index }: { item: string; index: number }) => (
      <GridItem
        uri={item}
        index={index}
        selected={selectedIndices.has(index)}
        selectionMode={selectionMode}
        onPress={() => handleGridPress(index)}
        onLongPress={() => handleGridLongPress(index)}
      />
    ),
    [selectionMode, selectedIndices],
  );

  const upscaledUri =
    selectedIndex !== null ? (upscaledUris[selectedIndex] ?? null) : null;
  const displayUri =
    selectedIndex !== null
      ? showingUpscaled && upscaledUri
        ? upscaledUri
        : photos[selectedIndex]
      : undefined;

  const selectionCount = selectedIndices.size;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        {selectionMode ? (
          <>
            <TouchableOpacity
              style={styles.backButton}
              onPress={exitSelectionMode}
            >
              <Text style={styles.backArrow}>✕</Text>
              <Text style={styles.backText}>CANCEL</Text>
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>{selectionCount} SELECTED</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.batchShareBtn,
                selectionCount === 0 && styles.batchShareBtnDisabled,
              ]}
              onPress={handleBatchShare}
              disabled={selectionCount === 0 || isBatchSharing}
            >
              <Text style={styles.batchShareIcon}>
                {isBatchSharing ? "…" : "↑"}
              </Text>
              <Text style={styles.batchShareLabel}>
                {isBatchSharing ? "SHARING" : "SHARE"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <Text style={styles.backArrow}>←</Text>
              <Text style={styles.backText}>CAMERA</Text>
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>BATCH</Text>
              <Text style={styles.headerCount}>{photos.length} SHOTS</Text>
            </View>
            <View style={{ minWidth: 80 }} />
          </>
        )}
      </View>

      {photos.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>NO PHOTOS YET</Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => router.back()}
          >
            <Text style={styles.emptyButtonText}>BACK TO CAMERA</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.hintBar}>
            <Text style={styles.hintText}>
              {selectionMode
                ? "TAP TO SELECT · SHARE WHEN READY"
                : "LONG-PRESS TO SELECT · TAP TO VIEW"}
            </Text>
          </View>
          <FlatList
            data={photos}
            renderItem={renderItem}
            keyExtractor={(_, i) => i.toString()}
            numColumns={COLS}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.row}
            showsVerticalScrollIndicator={false}
            extraData={{ selectionMode, selectedIndices }}
          />
        </>
      )}

      {/* ── Fullscreen Modal ── */}
      <Modal
        visible={selectedIndex !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closePhoto}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.modalContainer}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closePhoto} />

            {selectedIndex !== null && displayUri && (
              <>
                <ZoomableImage
                  key={`${selectedIndex}-${showingUpscaled}`}
                  uri={displayUri}
                />

                {/* Close */}
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={closePhoto}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>

                {/* Share — now shows a picker */}
                <TouchableOpacity
                  style={[
                    styles.shareButton,
                    isSharingFullscreen && styles.shareButtonSharing,
                  ]}
                  onPress={handleFullscreenShare}
                  disabled={isSharingFullscreen}
                  activeOpacity={0.75}
                >
                  <Text style={styles.shareButtonIcon}>
                    {isSharingFullscreen ? "…" : "↑"}
                  </Text>
                  <Text style={styles.shareButtonLabel}>
                    {isSharingFullscreen ? "SHARING" : "SHARE"}
                  </Text>
                </TouchableOpacity>

                {/* Upscale */}
                <TouchableOpacity
                  style={[
                    styles.upscaleButton,
                    isUpscaling && styles.upscaleButtonBusy,
                    showingUpscaled &&
                      upscaledUri &&
                      styles.upscaleButtonActive,
                  ]}
                  onPress={handleUpscale}
                  disabled={isUpscaling}
                  activeOpacity={0.75}
                >
                  <Text style={styles.upscaleButtonIcon}>
                    {isUpscaling ? "⏳" : upscaledUri ? "⇄" : "⬆︎"}
                  </Text>
                  <Text style={styles.upscaleButtonLabel}>
                    {isUpscaling
                      ? "PROCESSING"
                      : upscaledUri
                        ? showingUpscaled
                          ? "UPSCALED"
                          : "ORIGINAL"
                        : "UPSCALE"}
                  </Text>
                </TouchableOpacity>

                {/* Version badge */}
                {upscaledUri && (
                  <View
                    style={[
                      styles.versionBadge,
                      showingUpscaled
                        ? styles.versionBadgeUpscaled
                        : styles.versionBadgeOriginal,
                    ]}
                  >
                    <Text style={styles.versionBadgeText}>
                      {showingUpscaled ? "2× UPSCALED" : "ORIGINAL"}
                    </Text>
                  </View>
                )}

                {/* Nav */}
                <View style={styles.modalNav}>
                  <TouchableOpacity
                    style={[
                      styles.navButton,
                      selectedIndex === 0 && styles.navButtonDisabled,
                    ]}
                    onPress={goPrev}
                    disabled={selectedIndex === 0}
                  >
                    <Text style={styles.navButtonText}>‹</Text>
                  </TouchableOpacity>
                  <Text style={styles.navCounterText}>
                    {selectedIndex + 1} / {photos.length}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.navButton,
                      selectedIndex === photos.length - 1 &&
                        styles.navButtonDisabled,
                    ]}
                    onPress={goNext}
                    disabled={selectedIndex === photos.length - 1}
                  >
                    <Text style={styles.navButtonText}>›</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>

      <ToastComponent />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 60 : 44,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 80,
  },
  backArrow: { color: "#f0c040", fontSize: 20 },
  backText: {
    color: "#f0c040",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  headerCenter: { alignItems: "center" },
  headerTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 4,
  },
  headerCount: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 2,
    marginTop: 2,
  },

  // Batch share button (top-right in selection mode)
  batchShareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(240,192,64,0.18)",
    borderWidth: 1,
    borderColor: "#f0c040",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 80,
    justifyContent: "center",
  },
  batchShareBtnDisabled: { opacity: 0.35 },
  batchShareIcon: { color: "#f0c040", fontSize: 14, fontWeight: "800" },
  batchShareLabel: {
    color: "#f0c040",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },

  hintBar: {
    paddingVertical: 8,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  hintText: {
    color: "rgba(255,255,255,0.25)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2,
  },
  grid: { padding: GRID_PADDING, paddingTop: GRID_PADDING * 2 },
  row: { gap: GRID_PADDING, marginBottom: GRID_PADDING },
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    backgroundColor: "#1a1a1a",
    borderRadius: 4,
    overflow: "hidden",
  },
  gridImage: { width: "100%", height: "100%" },
  gridIndex: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  gridIndexText: { color: "#fff", fontSize: 9, fontWeight: "700" },

  // Selection overlay
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.0)",
  },
  selectionOverlayActive: {
    backgroundColor: "rgba(240,192,64,0.18)",
    borderWidth: 2.5,
    borderColor: "#f0c040",
    borderRadius: 4,
  },
  selectionCircle: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  selectionCircleActive: {
    backgroundColor: "#f0c040",
    borderColor: "#f0c040",
  },
  selectionCheck: { color: "#000", fontSize: 12, fontWeight: "900" },

  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
  },
  emptyText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 4,
  },
  emptyButton: {
    borderWidth: 1,
    borderColor: "#f0c040",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 4,
  },
  emptyButtonText: {
    color: "#f0c040",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenImage: { width, height: height * 0.8 },
  closeButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 44,
    right: 20,
    width: 40,
    height: 40,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: { color: "#fff", fontSize: 16 },
  shareButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 44,
    left: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(240,192,64,0.18)",
    borderWidth: 1,
    borderColor: "#f0c040",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareButtonSharing: { opacity: 0.6 },
  shareButtonIcon: { color: "#f0c040", fontSize: 14, fontWeight: "800" },
  shareButtonLabel: {
    color: "#f0c040",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },

  upscaleButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 110 : 96,
    left: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(80,180,255,0.15)",
    borderWidth: 1,
    borderColor: "#50b4ff",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  upscaleButtonBusy: { opacity: 0.5 },
  upscaleButtonActive: {
    backgroundColor: "rgba(80,255,160,0.15)",
    borderColor: "#50ffa0",
  },
  upscaleButtonIcon: { color: "#50b4ff", fontSize: 14, fontWeight: "800" },
  upscaleButtonLabel: {
    color: "#50b4ff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },

  versionBadge: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  versionBadgeOriginal: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.2)",
  },
  versionBadgeUpscaled: {
    backgroundColor: "rgba(80,255,160,0.12)",
    borderColor: "#50ffa0",
  },
  versionBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },

  modalNav: {
    position: "absolute",
    bottom: 60,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
  },
  navButton: {
    width: 52,
    height: 52,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
  },
  navButtonDisabled: { opacity: 0.2 },
  navButtonText: { color: "#fff", fontSize: 28, lineHeight: 32 },
  navCounterText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    minWidth: 70,
    textAlign: "center",
  },
  toast: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "rgba(30,30,30,0.92)",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  toastText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
