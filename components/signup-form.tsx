"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import Image from "next/image"
import { LoaderCircle } from "lucide-react"
import { useState } from "react"
import { toast } from "react-hot-toast"
import { authClient } from "@/utils/auth-client"
import { signupSchema } from "@/utils/zod"

type SignupFieldErrors = {
  email?: string
  password?: string
  confirmPassword?: string
}

type AuthProvider = "google" | "github"

const SIGNUP_ERROR_TOAST_ID = "signup-error-toast"
const SIGNUP_PROVIDER_ERROR_TOAST_ID = "signup-provider-error-toast"

export function SignupForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [providerLoading, setProviderLoading] = useState<AuthProvider | null>(null)

  const signupWithEmail = async (formData: FormData) => {
    if (isSubmitting || providerLoading) return

    setFieldErrors({})
    toast.dismiss(SIGNUP_ERROR_TOAST_ID)

    const email = String(formData.get("email") ?? "")
    const password = String(formData.get("password") ?? "")
    const confirmPassword = String(formData.get("confirm-password") ?? "")

    const zodResult = signupSchema.safeParse({
      email,
      password,
      confirmPassword,
    })

    if (!zodResult.success) {
      const { fieldErrors } = zodResult.error.flatten()
      const nextFieldErrors: SignupFieldErrors = {
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
        confirmPassword: fieldErrors.confirmPassword?.[0],
      }

      setFieldErrors(nextFieldErrors)
      console.error("Signup validation failed", fieldErrors)
      return
    }

    setIsSubmitting(true)
    const loadingToast = toast.loading("Creating your account...")
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    try {
      const { data, error } = await authClient.signUp.email({
        email: zodResult.data.email,
        password: zodResult.data.password,
        name: zodResult.data.email,
        callbackURL: "/dashboard",
      })

      if (error) {
        console.error("Signup failed", error)
        toast.error(error.message || "Could not create your account.", {
          id: SIGNUP_ERROR_TOAST_ID,
        })
        return
      }

      if (data) {
        window.location.href = "/dashboard"
      }
    } catch (error) {
      console.error("Unexpected signup error", error)
      toast.error("Something went wrong while creating your account.", {
        id: SIGNUP_ERROR_TOAST_ID,
      })
    } finally {
      toast.dismiss(loadingToast)
      setIsSubmitting(false)
    }
  }

  const signupWithProvider = async (provider: AuthProvider) => {
    if (isSubmitting || providerLoading) return

    setProviderLoading(provider)
    toast.dismiss(SIGNUP_PROVIDER_ERROR_TOAST_ID)

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: "/dashboard",
      })

      if (error) {
        console.error(`${provider} sign-in failed`, error)
        toast.error(error.message || `Could not continue with ${provider}.`, {
          id: SIGNUP_PROVIDER_ERROR_TOAST_ID,
        })
      }
    } catch (error) {
      console.error(`Unexpected ${provider} sign-in error`, error)
      toast.error(`Something went wrong while continuing with ${provider}.`, {
        id: SIGNUP_PROVIDER_ERROR_TOAST_ID,
      })
    } finally {
      setProviderLoading(null)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void signupWithEmail(new FormData(event.currentTarget))
            }}
            className="p-6 md:p-8"
          >
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Create your account</h1>
                <p className="text-sm text-balance text-muted-foreground">
                  Enter your email below to create your account
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                />
                {fieldErrors.email ? (
                  <FieldDescription className="text-destructive text-xs">
                    {fieldErrors.email}
                  </FieldDescription>
                ) : (
                  <FieldDescription>
                    We&apos;ll use this to contact you. We will not share your
                    email with anyone else.
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <Field className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      required
                    />
                    {fieldErrors.password ? (
                      <FieldDescription className="text-destructive text-xs">
                        {fieldErrors.password}
                      </FieldDescription>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">
                      Confirm Password
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirm-password"
                      type="password"
                      required
                    />
                    {fieldErrors.confirmPassword ? (
                      <FieldDescription className="text-destructive text-xs">
                        {fieldErrors.confirmPassword}
                      </FieldDescription>
                    ) : null}
                  </Field>
                </Field>
                <FieldDescription>
                  Must be at least 8 characters long.
                </FieldDescription>
              </Field>
              <Field>
                <Button
                  type="submit"
                  disabled={isSubmitting || Boolean(providerLoading)}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" />
                      Creating Account...
                    </span>
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </Field>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                Or continue with
              </FieldSeparator>
              <Field className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  type="button"
                  disabled={isSubmitting || Boolean(providerLoading)}
                  onClick={() => void signupWithProvider("google")}
                >
                  {providerLoading === "google" ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" />
                      Google
                    </span>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span>Google</span>
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  disabled={isSubmitting || Boolean(providerLoading)}
                  onClick={() => void signupWithProvider("github")}
                >
                  {providerLoading === "github" ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" />
                      GitHub
                    </span>
                  ) : (
                    <>
                      <GitHubIcon />
                      <span>GitHub</span>
                    </>
                  )}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                Already have an account? <a href="/login">Sign in</a>
              </FieldDescription>
            </FieldGroup>
          </form>
          <div className="relative hidden bg-muted md:block">
            <Image
              src="/empty-bucket-svgrepo-com.svg"
              alt="Signup illustration"
              fill
              className="object-contain p-10 dark:brightness-[0.9] dark:grayscale"
              priority
            />
          </div>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        d="M12.0003 4.75C13.7703 4.75 15.3503 5.36 16.5903 6.55L20.0303 3.11C17.9403 1.16 15.2303 0 12.0003 0C7.31027 0 3.26027 2.69 1.28027 6.61L5.27027 9.71C6.22027 6.86 8.88027 4.75 12.0003 4.75Z"
        fill="#EA4335"
      />
      <path
        d="M23.49 12.27C23.49 11.48 23.42 10.72 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.24 16.09 18.09L19.95 21.09C22.21 19 23.49 15.91 23.49 12.27Z"
        fill="#4285F4"
      />
      <path
        d="M5.26998 14.2901C5.01998 13.5701 4.87998 12.8001 4.87998 12.0001C4.87998 11.2001 5.01998 10.4301 5.26998 9.71008L1.27998 6.62012C0.45998 8.24012 0 10.0601 0 12.0001C0 13.9401 0.45998 15.7601 1.27998 17.3801L5.26998 14.2901Z"
        fill="#FBBC05"
      />
      <path
        d="M12.0004 24C15.2304 24 17.9404 22.94 19.9504 21.09L16.0904 18.09C15.0304 18.81 13.6804 19.25 12.0004 19.25C8.88043 19.25 6.22043 17.14 5.27043 14.29L1.28043 17.38C3.26043 21.31 7.31043 24 12.0004 24Z"
        fill="#34A853"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58 0-.28-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.54-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.08 1.84 2.82 1.31 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.52 11.52 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.69.82.57C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  )
}
