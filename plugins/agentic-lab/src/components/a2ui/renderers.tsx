import React, { useState } from 'react';

/**
 * A2UI React renderers — map each abstract component type from the
 * definitions to a concrete React implementation.
 */

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 12,
  padding: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

export function MetricCardRenderer({
  props,
}: {
  props: {
    title: string;
    value: string;
    trend?: 'up' | 'down' | 'flat';
    description?: string;
  };
}) {
  const trendIcon =
    props.trend === 'up' ? '📈' : props.trend === 'down' ? '📉' : '➖';
  return (
    <div style={cardStyle}>
      <div style={{ color: '#78909c', fontSize: 12, fontWeight: 600 }}>
        {props.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{props.value}</div>
        <span>{trendIcon}</span>
      </div>
      {props.description && (
        <div style={{ color: '#90a4ae', fontSize: 12 }}>{props.description}</div>
      )}
    </div>
  );
}

export function InfoFormRenderer({
  props,
}: {
  props: {
    title: string;
    fields: { label: string; placeholder?: string; required?: boolean }[];
    submitLabel?: string;
  };
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{props.title}</div>
      {props.fields.map(f => (
        <div key={f.label} style={{ marginBottom: 10 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              color: '#546e7a',
              marginBottom: 4,
            }}
          >
            {f.label}
            {f.required && <span style={{ color: '#e53935' }}> *</span>}
          </label>
          <input
            value={values[f.label] ?? ''}
            placeholder={f.placeholder}
            onChange={e => setValues(v => ({ ...v, [f.label]: e.target.value }))}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid #cfd8dc',
              fontSize: 14,
            }}
          />
        </div>
      ))}
      <button
        onClick={() => setSubmitted(true)}
        style={{
          background: '#465af0',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '8px 16px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {props.submitLabel ?? 'Submit'}
      </button>
      {submitted && (
        <div style={{ color: '#2e7d32', fontSize: 13, marginTop: 8 }}>
          ✓ Submitted: {JSON.stringify(values)}
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS = {
  healthy: '#2e7d32',
  warning: '#f9a825',
  error: '#c62828',
} as const;

export function StatusListRenderer({
  props,
}: {
  props: {
    title: string;
    items: {
      name: string;
      status: 'healthy' | 'warning' | 'error';
      detail?: string;
    }[];
  };
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{props.title}</div>
      {props.items.map(item => (
        <div
          key={item.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 0',
            borderBottom: '1px solid #f5f5f5',
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: STATUS_COLORS[item.status],
              display: 'inline-block',
            }}
          />
          <span style={{ fontWeight: 500 }}>{item.name}</span>
          {item.detail && (
            <span style={{ color: '#90a4ae', fontSize: 12 }}>{item.detail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export const myRenderers = {
  'metric-card': MetricCardRenderer,
  'info-form': InfoFormRenderer,
  'status-list': StatusListRenderer,
};
