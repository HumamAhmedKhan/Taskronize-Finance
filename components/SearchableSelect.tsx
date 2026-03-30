
import React from 'react';
import Select from 'react-select';

interface Option {
  value: any;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: any;
  onChange: (value: any) => void;
  placeholder?: string;
  isClearable?: boolean;
  className?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({ 
  options, 
  value, 
  onChange, 
  placeholder = "Search...", 
  isClearable = true,
  className = ""
}) => {
  const selectedOption = options.find(opt => opt.value === value) || null;

  const customStyles = {
    control: (base: any) => ({
      ...base,
      padding: '2px',
      borderRadius: '0.5rem',
      borderColor: '#e2e8f0',
      '&:hover': {
        borderColor: '#cbd5e1'
      },
      boxShadow: 'none'
    }),
    placeholder: (base: any) => ({
      ...base,
      color: '#94a3b8'
    })
  };

  return (
    <div className={className}>
      <Select
        options={options}
        value={selectedOption}
        onChange={(option: any) => onChange(option?.value)}
        placeholder={placeholder}
        isSearchable
        isClearable={isClearable}
        styles={customStyles}
        classNamePrefix="react-select"
      />
    </div>
  );
};

export default SearchableSelect;
