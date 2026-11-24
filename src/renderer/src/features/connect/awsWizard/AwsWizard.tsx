/** The "30-second connection" wizard: Profile → Database → Connect. */
import { useState } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import type { RdsDatabase } from '@shared/types/aws'
import { Button } from '@renderer/components/ui/button'
import { setState } from '@renderer/lib/store'
import { cn } from '@renderer/lib/utils'
import { StepConnect } from './StepConnect'
import { StepDatabase } from './StepDatabase'
import { StepProfile, type ProfileSelection } from './StepProfile'

const STEPS = ['AWS profile', 'Database', 'Connect'] as const

export function AwsWizard() {
  const [step, setStep] = useState(0)
  const [selection, setSelection] = useState<ProfileSelection | null>(null)
  const [db, setDb] = useState<RdsDatabase | null>(null)

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-auto p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => setState({ screen: { name: 'home' } })} title="Back to connections">
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">New AWS connection</h1>
      </div>

      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                i < step && 'border-emerald-500 bg-emerald-500/20 text-emerald-400',
                i === step && 'border-foreground text-foreground',
                i > step && 'text-muted-foreground'
              )}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn('text-xs', i === step ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      <div className="rounded-lg border bg-card p-4">
        {step === 0 && (
          <StepProfile
            initial={selection ?? {}}
            onNext={(s) => {
              setSelection(s)
              setStep(1)
            }}
          />
        )}
        {step === 1 && selection && (
          <StepDatabase
            profile={selection.profile}
            region={selection.region}
            onBack={() => setStep(0)}
            onNext={(d) => {
              setDb(d)
              setStep(2)
            }}
          />
        )}
        {step === 2 && selection && db && (
          <StepConnect profile={selection.profile} region={selection.region} db={db} onBack={() => setStep(1)} />
        )}
      </div>
    </div>
  )
}
