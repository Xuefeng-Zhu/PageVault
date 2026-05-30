'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Stepper } from '@/components/dashboard/Stepper';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/components/ui/Toast';

const steps = [
  { id: 1, label: 'Room Details', description: '' },
  { id: 2, label: 'Add URLs', description: '' },
  { id: 3, label: 'Configure Alerts', description: '' },
  { id: 4, label: 'Review', description: '' },
];

const frequencyOptions = [
  { value: '1', label: 'Every hour' },
  { value: '24', label: 'Daily' },
  { value: '168', label: 'Weekly' },
];

// Example URLs for placeholder suggestions
const exampleUrls = [
  { domain: 'AWS', baseUrl: 'https://aws.amazon.com', paths: ['/', '/ec2/', '/s3/', '/lambda/', '/iam/'] },
  { domain: 'Apify', baseUrl: 'https://apify.com', paths: ['/', '/pricing', '/storage', '/actor'] },
  { domain: 'Box', baseUrl: 'https://www.box.com', paths: ['/', '/security', '/integrations', '/developers'] },
];

export default function NewRoomPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    frequency: '24',
    emailHighSeverity: false,
    emailAllChanges: false,
    slackNotification: false,
    urls: [] as string[],
  });

  const [newUrl, setNewUrl] = useState('');

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCheckboxChange = (field: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [field]: checked }));
  };

  const handleAddUrl = () => {
    if (newUrl.trim()) {
      setFormData((prev) => ({
        ...prev,
        urls: [...prev.urls, newUrl.trim()],
      }));
      setNewUrl('');
    }
  };

  const handleRemoveUrl = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      urls: prev.urls.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      showToast('Room created successfully!', 'success');
      router.push('/dashboard');
    } catch {
      showToast('Failed to create room', 'error');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f8fafc' }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Step indicator */}
        <div 
          className="bg-white border mb-8 rounded-xl px-6 py-4"
          style={{ borderColor: '#e2e8f0' }}
        >
          <Stepper steps={steps} currentStep={currentStep} />
        </div>

        {/* Form content */}
        <div 
          className="bg-white border rounded-xl px-6 py-6"
          style={{ borderColor: '#e2e8f0' }}
        >
          {/* Step 1: Room Details */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <h1 
                className="text-2xl font-bold"
                style={{ color: '#131b2e' }}
              >
                Create Memory Room
              </h1>
              
              <Input
                label="Room name"
                placeholder="e.g., Cloud Infrastructure Monitor"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
              />

              <div>
                <label 
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: '#131b2e' }}
                >
                  Description
                </label>
                <textarea
                  placeholder="What are you monitoring and why? e.g., Track AWS service updates and pricing changes"
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border text-base transition-colors focus:outline-none focus:ring-2"
                  style={{ 
                    borderColor: '#e2e8f0',
                    backgroundColor: '#ffffff',
                    color: '#131b2e',
                  }}
                />
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={() => setCurrentStep(2)}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Add URLs */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h2 
                className="text-xl font-semibold"
                style={{ color: '#131b2e' }}
              >
                Add URLs
              </h2>

              <div className="flex gap-3">
                <Input
                  placeholder="https://aws.amazon.com/lambda/"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="flex-1"
                />
                <Button variant="secondary" onClick={handleAddUrl}>
                  Add URL
                </Button>
              </div>

              {/* Example URLs */}
              <div className="text-sm" style={{ color: '#434655' }}>
                <p className="mb-2 font-medium">Example URLs:</p>
                {exampleUrls.map((example) => (
                  <div key={example.domain} className="mb-2">
                    <span className="font-medium">{example.domain}:</span>
                    <div className="ml-4 mt-1 space-y-1">
                      {example.paths.map((path) => (
                        <code key={path} className="block text-xs bg-slate-100 px-2 py-1 rounded">
                          {example.baseUrl}{path}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {formData.urls.length > 0 && (
                <div 
                  className="border rounded-lg divide-y"
                  style={{ borderColor: '#e2e8f0' }}
                >
                  {formData.urls.map((url, index) => (
                    <div 
                      key={index} 
                      className="flex items-center justify-between p-3"
                    >
                      <span 
                        className="text-sm font-mono"
                        style={{ color: '#131b2e' }}
                      >
                        {url}
                      </span>
                      <button
                        onClick={() => handleRemoveUrl(index)}
                        className="p-1 hover:opacity-70 transition-opacity"
                        style={{ color: '#434655' }}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentStep(1)}
                >
                  Back
                </Button>
                <Button onClick={() => setCurrentStep(3)}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Configure Alerts */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <h2 
                className="text-xl font-semibold"
                style={{ color: '#131b2e' }}
              >
                Configure Alerts
              </h2>

              <Select
                label="Scan frequency"
                options={frequencyOptions}
                value={formData.frequency}
                onChange={(e) => handleInputChange('frequency', e.target.value)}
              />

              <div className="space-y-3">
                <label 
                  className="block text-sm font-medium"
                  style={{ color: '#131b2e' }}
                >
                  Alert preferences
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.emailHighSeverity}
                    onChange={(e) => handleCheckboxChange('emailHighSeverity', e.target.checked)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: '#2563eb' }}
                  />
                  <span style={{ color: '#131b2e' }}>Email on high severity</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.emailAllChanges}
                    onChange={(e) => handleCheckboxChange('emailAllChanges', e.target.checked)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: '#2563eb' }}
                  />
                  <span style={{ color: '#131b2e' }}>Email on all changes</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.slackNotification}
                    onChange={(e) => handleCheckboxChange('slackNotification', e.target.checked)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: '#2563eb' }}
                  />
                  <span style={{ color: '#131b2e' }}>Slack notification</span>
                </label>
              </div>

              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentStep(2)}
                >
                  Back
                </Button>
                <Button onClick={() => setCurrentStep(4)}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <h2 
                className="text-xl font-semibold"
                style={{ color: '#131b2e' }}
              >
                Review
              </h2>

              <div 
                className="border rounded-lg divide-y"
                style={{ borderColor: '#e2e8f0' }}
              >
                <div className="p-4">
                  <span 
                    className="text-xs uppercase tracking-wide"
                    style={{ color: '#434655' }}
                  >
                    Room Name
                  </span>
                  <p 
                    className="font-medium mt-1"
                    style={{ color: '#131b2e' }}
                  >
                    {formData.name || 'Not set'}
                  </p>
                </div>

                <div className="p-4">
                  <span 
                    className="text-xs uppercase tracking-wide"
                    style={{ color: '#434655' }}
                  >
                    Description
                  </span>
                  <p 
                    className="font-medium mt-1"
                    style={{ color: '#131b2e' }}
                  >
                    {formData.description || 'Not set'}
                  </p>
                </div>

                <div className="p-4">
                  <span 
                    className="text-xs uppercase tracking-wide"
                    style={{ color: '#434655' }}
                  >
                    URLs
                  </span>
                  <p 
                    className="font-medium mt-1"
                    style={{ color: '#131b2e' }}
                  >
                    {formData.urls.length > 0 ? `${formData.urls.length} URL(s)` : 'No URLs added'}
                  </p>
                </div>

                <div className="p-4">
                  <span 
                    className="text-xs uppercase tracking-wide"
                    style={{ color: '#434655' }}
                  >
                    Scan Frequency
                  </span>
                  <p 
                    className="font-medium mt-1"
                    style={{ color: '#131b2e' }}
                  >
                    {frequencyOptions.find(f => f.value === formData.frequency)?.label || 'Not set'}
                  </p>
                </div>

                <div className="p-4">
                  <span 
                    className="text-xs uppercase tracking-wide"
                    style={{ color: '#434655' }}
                  >
                    Alert Preferences
                  </span>
                  <p 
                    className="font-medium mt-1"
                    style={{ color: '#131b2e' }}
                  >
                    {[
                      formData.emailHighSeverity && 'Email on high severity',
                      formData.emailAllChanges && 'Email on all changes',
                      formData.slackNotification && 'Slack notification',
                    ].filter(Boolean).join(', ') || 'None configured'}
                  </p>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentStep(3)}
                >
                  Back
                </Button>
                <Button 
                  onClick={handleSubmit} 
                  loading={loading}
                  style={{ backgroundColor: '#2563eb' }}
                >
                  Create Room
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}