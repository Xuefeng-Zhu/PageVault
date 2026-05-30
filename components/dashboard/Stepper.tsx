'use client';

interface StepperProps {
  steps: { id: number; label: string; description: string }[];
  currentStep: number;
}

export function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center flex-1">
          <div className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                step.id <= currentStep
                  ? 'bg-primary-container text-on-primary-container'
                  : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {step.id < currentStep ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step.id
              )}
            </div>
            <div className="ml-3">
              <div className={`text-body-md font-medium ${step.id <= currentStep ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                {step.label}
              </div>
              <div className="text-label-sm text-on-surface-variant">{step.description}</div>
            </div>
          </div>
          {index < steps.length - 1 && (
            <div className={`flex-1 h-px mx-4 ${step.id < currentStep ? 'bg-primary-container' : 'bg-outline-variant'}`} />
          )}
        </div>
      ))}
    </div>
  );
}