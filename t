// Import required dependencies
import React, { useState, useEffect } from 'react';
import { useWizardContext } from './Wizard';

interface Props {
  // Add any required props
}

const Step3: React.FC<Props> = () => {
  const { matchedMasters } = useWizardContext();
  const [masters, setMasters] = useState<Master[]>([]);

  useEffect(() => {
    if (matchedMasters) {
      setMasters(matchedMasters);
    }
  }, [matchedMasters]);

  return (
    <div>
      <h1>Step 3</h1>
      <ul>
        {masters.map((master) => (
          <li key={master.id}>{master.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default Step3;