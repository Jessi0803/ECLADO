import React from 'react';
import { PAYMENT_METHODS } from '../../domain/payments.js';
import './PaymentMethodOptions.css';

export default function PaymentMethodOptions({ value, onChange, disabled, unavailableMethod }) {
  return (
    <div role="group" aria-label="付款方式">
      <div className="payment-method-heading">付款方式</div>
      <div className="payment-method-options">
        {Object.entries(PAYMENT_METHODS).map(([key, method]) => (
          <button key={key} type="button" className="payment-method-option"
            aria-pressed={value === key} disabled={disabled || key === unavailableMethod} onClick={() => onChange(key)}>
            <span className="payment-method-indicator" aria-hidden="true" />
            <span>
              <span className="payment-method-name">{method.label}</span>
              <span className="payment-method-description">
                {key === unavailableMethod ? '單筆匯款上限為 NT$ 30,000。' : method.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
