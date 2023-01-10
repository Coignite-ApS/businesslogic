import * as helpers from '../Helpers/HelperFunctions';
import { WebForm, WebFormErrors } from "../interfaces";


export interface validationMessages {
    valueMissing: any;
    typeMismatch: any;
    patternMismatch: any;
    tooLong: any;
    tooShort: any;
    rangeUnderflow: any;
    rangeOverflow: any;
    stepMismatch: any;
    badInput: any;
    customError: any;
    valid: any;
}

export class WebFormValidation {
    private errors: WebFormErrors;
    private defaultMessages: validationMessages;
    private formElement: HTMLFormElement;
    private webform: WebForm;
    private customErrorMessages: boolean;

    constructor(language: string = '', webform?: WebForm) {
        this.formElement = new HTMLFormElement();
        this.webform = webform;
    }

    private validate(): Boolean {
        let valid: boolean = true;
        this.errors = {};

        if (this.formElement) {
            // Use native form validation
            this.formElement.customMessages = true;
            valid = this.formElement.checkValidity(); // Returns true if the element's value has no validity problems; false otherwise. Fires an invalid event at the element in the latter case.
            //valid = this.formElement.reportValidity(); // Returns true if the element's value has no validity problems; otherwise, returns false, fires an invalid event at the element, and (if the event isn't canceled) reports the problem to the user.
        } else {
            // Use input validation
            let inputValid: boolean;
            for(let el in this.webform.inputs) {
                let input = <HTMLInputElement>this.webform.inputs[el].input_el;
                let willValidate = input.willValidate; // Returns true if the element will be validated when the form is submitted; false otherwise.
                let custom = false;
                let message = '';
                if (!this.customErrorMessages) {
                    message = input.validationMessage; // Returns the error message that would be shown to the user if the element was to be checked for validity.
                } else if (input.validity.valueMissing) {

                } else if (input.validity.typeMismatch) {

                } else if (input.validity.typeMismatch) {

                } else if (input.validity.patternMismatch) {

                } else if (input.validity.tooLong) {

                } else if (input.validity.tooShort) {

                } else if (input.validity.rangeUnderflow) {

                } else if (input.validity.rangeOverflow) {

                } else if (input.validity.stepMismatch) {

                } else if (input.validity.badInput) {

                } else if (input.validity.customError) {

                } else if (input.validity.valid) {

                } else {
                    //this.updateErrorMessage(el,'');
                }
                if (custom) input.setCustomValidity(message); // Sets a custom error, so that the element would fail to validate. The given message is the message to be shown to the user when reporting the problem to the user.
                this.errors[el] = message;
                // this.updateErrorMessage(el,message);
            }


            if (!helpers.isEmpty(this.errors)) {
                valid = false
            }
        }

        if (!valid) {
            /*
            this.ValidationFailedListener.emit({
                errors: this.errors
            });
            */
        }

        return valid;
    }

    private setErrorMessages(value: string) {
        this.defaultMessages = {
            valueMissing: `${value} is required `, // Returns true if the element has no value but is a required field; false otherwise.
            typeMismatch: `Some text here ${value}`, // Returns true if the element's value is not in the correct syntax; false otherwise.
            patternMismatch: `String does not match pattern: ${value}`, // Returns true if the element's value doesn't match the provided pattern; false otherwise.
            tooLong: `Some text here ${value}`, // Returns true if the element's value is longer than the provided maximum length; false otherwise.
            tooShort: `Some text here ${value}`, // Returns true if the element's value, if it is not the empty string, is shorter than the provided minimum length; false otherwise.
            rangeUnderflow: `Some text here ${value}`, // Returns true if the element's value is lower than the provided minimum; false otherwise.
            rangeOverflow: `Some text here ${value}`, // Returns true if the element's value is higher than the provided maximum; false otherwise.
            stepMismatch: `Some text here ${value}`, // Returns true if the element's value doesn't fit the rules given by the step attribute; false otherwise.
            badInput: `Some text here ${value}`, // Returns true if the user has provided input in the user interface that the user agent is unable to convert to a value; false otherwise.
            customError: `Some text here ${value}`, // Returns true if the element has a custom error; false otherwise.
            valid: `Some text here ${value}` // Returns true if the element's value has no validity problems; false otherwise.
        }
    }
}
