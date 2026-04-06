import { Stack, Redirect } from "expo-router";
import { useAuth } from "../../api/AuthContext";

export default function AuthLayout() {
  const { user } = useAuth();

  if (user) {
    return <Redirect href="/camera" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
