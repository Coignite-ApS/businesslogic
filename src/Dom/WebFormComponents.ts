type control =
    'text'          |
    'number'        |
    'integer'       |
    'text-data'     | // Input with datalist
    'textarea'      |
    'select'        |
    'checkbox'      |
    'radio'         |
    'range'         |
    'password'      |
    'email'         |
    'tel'           |
    'time'          |
    'date'          |
    'month'         |
    'week'          |
    'submit'        |
    'submit-reset'  |
    'output'        |
    'output-meter'  |
    'output-progress'

export class WebFormComponents {

    private webformComponents: string;
    private groupName:string;

    constructor(groupName?:string) {
        this.webformComponents = '';
        this.groupName = groupName;
    }

    public compileWebformComponents():Element {
        this.webformComponents = this.groupComponents(this.webformComponents ,this.groupName);
        return  new DOMParser().parseFromString(this.webformComponents,'text/html').body.children[0];
    }

    public getWebformComponents():string {
        return  this.webformComponents;
    }

    public attachComponent(control:control,param?:string, options?:any): void {
        let component;

        switch(control) {
            case 'text':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='text' class='form-control' id='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'number':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='number' class='form-control' id='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'integer':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='number' class='form-control' id='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'text-data':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='number' class='form-control' id='${param}' bl-input='${param}' list='${param}Datalist'>
                    <datalist id='${param}Datalist'></datalist>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'textarea':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <textarea class='form-control' rows='5' id='${param}' bl-input-label='${param}'></textarea>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'select':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <select type='text' class='form-control' id='${param}' bl-input='${param}'></select>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
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
                    <input type='range' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'email':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='email' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'tel':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='tel' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'password':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='password' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'time':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='time' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'date':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='date' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'month':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='month' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;

            case 'week':
                component = `
                    <label for='${param}' bl-input-label='${param}'></label>
                    <input type='week' id='${param}' name='${param}' bl-input='${param}'>
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
                break;
            case 'submit':
                component = `
                    <input class='btn' type='submit' bl-control='submit'>
                `;
                break;
            case 'submit-reset':
                component = `
                    <input class='btn' type='submit' bl-control='submit'>
                    <input class='btn' type='reset' bl-control='reset'>
                `;
                break;
            case 'output':
                component = `
                    <label class='output-row'><div><span bl-output-label='${param}'></span><span>: </span></div><div><span bl-output='${param}'></span> <span bl-output-description='${param}'></span></div></label>
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
                    <small class='form-text text-muted' bl-input-description='${param}'></small>
                    <small bl-input-error='${param}'></small>
                `;
        }

        /*
        const markup = `
    <ul class='dogs'>
        ${options.map((option:any) =>
            `<li>${option.name}
                </li>`
        ).join('')}
     </ul>
    `;
    */

        // Wrap inside the group
        component = this.groupComponents(component,'form-group');

        this.webformComponents += component;

    }

    public groupComponents(component:string,groupClass:string):string{
        return  `<div class='${groupClass}'>${component}</div>`;
    }

}