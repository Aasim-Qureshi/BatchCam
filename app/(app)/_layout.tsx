import { Stack, Redirect } from "expo-router";
import { useAuth } from "../../api/AuthContext";

export default function AppLayout() {
  const { user } = useAuth();

  if (!user) {
    return <Redirect href="/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
