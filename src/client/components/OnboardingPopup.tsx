import React, { useEffect, useState } from 'react';
import { hasSeenOnboarding, markOnboardingSeen } from '../lib/share';

interface Props {
  fileLoaded: boolean;
}

export function OnboardingPopup({ fileLoaded }: Props): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (fileLoaded && !hasSeenOnboarding()) {
      setVisible(true);
    }
  }, [fileLoaded]);

  function dismiss() {
    markOnboardingSeen();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="onboarding-popup" role="dialog" aria-modal="true" aria-label="How to comment">
      <div className="onboarding-popup__content">
        <p className="onboarding-popup__title">Leave a comment</p>
        <ol className="onboarding-popup__steps">
          <li>Select any text in the document</li>
          <li>Press <kbd>⇧C</kbd> (or click the tooltip)</li>
          <li>Type your comment and press <kbd>⌘↵</kbd></li>
        </ol>
        <button className="onboarding-popup__btn" onClick={dismiss} type="button">
          Got it
        </button>
      </div>
    </div>
  );
}
