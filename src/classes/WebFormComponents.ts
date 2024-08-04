type control =
    'businesslogic' |
    'text' |
    'number' |
    'integer' |
    'text-data' | // Input with datalist
    'textarea' |
    'select' |
    'checkbox' |
    'radio' |
    'range' |
    'password' |
    'email' |
    'tel' |
    'time' |
    'date' |
    'month' |
    'week' |
    'submit' |
    'submit-reset' |
    'output' |
    'output-array' |
    'output-meter' |
    'output-progress'

export class WebFormComponents {
    public webformComponents: HTMLElement;
    private groupName: string;

    constructor(groupName?: string) {
        this.webformComponents = document.createElement('div'); // Initialize as a div element
        if (groupName) this.webformComponents.className = `${groupName}`;

        this.groupName = groupName ? groupName : '';
    }

    public setBgImgContainer(imgUrl: string): void {
        const bgContainer = document.createElement('div');
        bgContainer.classList.add('bg-img-container');
        bgContainer.style.backgroundImage = `url(${imgUrl})`;
        this.webformComponents.appendChild(bgContainer);
    }

    public attachComponent(control: control, param?: string, options?: any): void {
        let component = '';
        let componentWrapperEl = document.createElement('div');
        let submit = '';
        let reset = '';

        switch (control) {
            case 'businesslogic':
                component = `
                <a class='logo' title='Power by businesslogic.online' href='https://businesslogic.online' target='_blank'></a>
            `;
                break;
            case 'text':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='text' class='form-control' id='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'number':
            case 'integer':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='number' class='form-control' id='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'text-data':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='number' class='form-control' id='${param}' bl-input='${param}' list='${param}Datalist'>
                <datalist id='${param}Datalist'></datalist>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'textarea':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <textarea class='form-control' rows='5' id='${param}' bl-input-label='${param}'></textarea>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'select':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <select type='text' class='form-control' id='${param}' bl-input='${param}'></select>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'checkbox':
                component = `
                <label><input type='checkbox' id='${param}' name='${param}' bl-input='${param}'><span bl-input-label='${param}'></span></label>
            `;
                break;
            case 'radio':
                component = `
                <label><input type='radio' id='${param}' name='${param}' bl-input='${param}'><span bl-input-label='${param}'></span></label>
            `;
                break;
            case 'range':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <div class='range-group'>
                    <span class='min'>${options.minimum}</span>
                    <div class='range-control'>
                        <input type='range'
                            min='${options.minimum}'
                            max='${options.maximum}'
                            value='${options.default}'
                            step='${options.multipleOf}'
                            id='${param}' name='${param}' bl-input='${param}'
                            style='background-size: ${(!!(options.default % options.multipleOf) ? options.default - (options.default % options.multipleOf) : options.default - options.minimum) * 100 / (options.maximum - options.minimum)}% 100%'>
                    </div>
                    <span class='max'>${options.maximum}</span>
                </div>
                <p>
                    <div class='range-desc'>
                        <small class='form-text text-muted' bl-input-description='${param}'></small>
                        <div class='range-output'>
                            <output id='rangevalue'>${options.default}</output>
                        </div>
                    </div>
                    <small bl-input-error='${param}'></small>
                </p>
            `;
                break;
            case 'email':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='email' id='${param}' name='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'tel':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='tel' id='${param}' name='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'password':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='password' id='${param}' name='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'time':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='time' id='${param}' name='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'date':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='date' id='${param}' name='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'month':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='month' id='${param}' name='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'week':
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='week' id='${param}' name='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
            case 'submit':
                submit = options.submit ? `value='${options.submit}'` : ``;
                component = `
                <input class='btn btn-primary' ${submit} type='submit' bl-control='submit'>
            `;
                break;
            case 'submit-reset':
                submit = options.submit ? `value='${options.submit}'` : ``;
                reset = options.reset ? `value='${options.reset}'` : ``;
                component = `
                <input class='btn btn-primary' ${submit} type='submit' bl-control='submit'>
                <input class='btn btn-secondary' ${reset} type='reset' bl-control='reset'>
            `;
                break;
            case 'output':
                component = `
                <label class='output-row'><div><span bl-output-label='${param}'></span><span>: </span></div><div><span bl-output='${param}'></span> <span bl-output-description='${param}'></span></div></label>
            `;
                break;
            case 'output-array':
                component = `
                <label class=''><div><span bl-output-label='${param}'></span><span>: </span></div><div><span bl-output-description='${param}'></span></div>
                </label>
                <p class='output-array small'><span bl-output='${param}'></span></p>
            `;
                break;
            case 'output-meter':
                component = `
                <label for='${param}' bl-output-label='${param}'></label>
                <meter bl-output='${param}'></meter>
            `;
                break;
            case 'output-progress':
                component = `
                <label for='${param}' bl-output-label='${param}'></label>
                <progress bl-output='${param}'></progress>
            `;
                break;
            default:
                component = `
                <label for='${param}' bl-input-label='${param}'></label>
                <input type='string' class='form-control' id='${param}' bl-input='${param}'>
                <p><small class='form-text text-muted' bl-input-description='${param}'></small>
                <small bl-input-error='${param}'></small></p>
            `;
                break;
        }

        // Create the DOM element from the component string
        componentWrapperEl.innerHTML = component;

        // Wrap inside the group if applicable
        if (this.groupName !== '') {
            const wrappedEl = document.createElement('div');
            wrappedEl.innerHTML = this.groupComponents(componentWrapperEl.innerHTML, 'form-group');
            componentWrapperEl = wrappedEl;
        }

        this.webformComponents.appendChild(componentWrapperEl.firstElementChild);
    }

    public groupComponents(component: string, groupClass: string): string {
        return `<div class='${groupClass}'>${component}</div>`;
    }
}
