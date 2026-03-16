import { useState, useCallback, useRef } from "react";
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
      if (scale.value > 1) {
        resetZoom();
      } else {
        scale.value = withSpring(3);
        savedScale.value = 3;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan);
  const gesture = Gesture.Race(doubleTap, composed);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.Image
        source={{ uri }}
        style={[styles.fullscreenImage, animStyle]}
        resizeMode="contain"
      />
    </GestureDetector>
  );
}

function GridItem({
  uri,
  index,
  onPress,
  onLongPress,
}: {
  uri: string;
  index: number;
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
        <View style={styles.gridIndex}>
          <Text style={styles.gridIndexText}>{index + 1}</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function GalleryScreen() {
  const photos = capturedPhotos;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sharingIndex, setSharingIndex] = useState<number | null>(null);
  const { show: showToast, ToastComponent } = useToast();

  const handleShare = async (index: number) => {
    setSharingIndex(index);
    const ok = await sharePhoto(photos[index]);
    setSharingIndex(null);
    if (!ok) showToast("Could not share photo");
  };

  const openPhoto = (index: number) => setSelectedIndex(index);
  const closePhoto = () => setSelectedIndex(null);
  const goNext = () => {
    if (selectedIndex !== null && selectedIndex < photos.length - 1)
      setSelectedIndex(selectedIndex + 1);
  };
  const goPrev = () => {
    if (selectedIndex !== null && selectedIndex > 0)
      setSelectedIndex(selectedIndex - 1);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: string; index: number }) => (
      <GridItem
        uri={item}
        index={index}
        onPress={() => openPhoto(index)}
        onLongPress={() => handleShare(index)}
      />
    ),
    [],
  );

  const isSharing = selectedIndex !== null && sharingIndex === selectedIndex;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
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
              LONG-PRESS TO SHARE · TAP TO VIEW
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
          />
        </>
      )}

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

            {selectedIndex !== null && (
              <>
                <ZoomableImage
                  key={selectedIndex}
                  uri={photos[selectedIndex]}
                />

                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={closePhoto}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.shareButton,
                    isSharing && styles.shareButtonSharing,
                  ]}
                  onPress={() => handleShare(selectedIndex)}
                  disabled={isSharing}
                  activeOpacity={0.75}
                >
                  <Text style={styles.shareButtonIcon}>
                    {isSharing ? "…" : "↑"}
                  </Text>
                  <Text style={styles.shareButtonLabel}>
                    {isSharing ? "SHARING" : "SHARE"}
                  </Text>
                </TouchableOpacity>

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
