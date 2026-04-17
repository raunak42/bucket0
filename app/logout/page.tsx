"use client";
import { authClient } from "@/utils/auth-client";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Page() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogoutClick = async () => {
    setLoading(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/login");
          setLoading(false);
        },
        onError(context) {
          setLoading(false);
          console.error(context.error);
        },
      },
    });
  };
  return (
    <div className="w-screen h-screen flex items-center justify-center pt-[80px]">
      <button
        onClick={handleLogoutClick}
        className="w-[120px] h-[40px] rounded-[4px] bg-black text-white text-[12px] font-medium hover:cursor-pointer flex items-center justify-center"
      >
        {loading ? <LoaderCircle className="animate-spin" /> : <h1>Logout</h1>}
      </button>
    </div>
  );
}
