
const axios = require("axios");
const otherFunctions = require("../common_functions.js");


class PIAPI{

#actionslabelsMapping = {
    reroll: {label:"🔄", task_type:"reroll"},
    upscale1: {label:"U1", task_type:"upscale", index: "1"},
    upscale2: {label:"U2", task_type:"upscale", index: "2"},
    upscale3: {label:"U3", task_type:"upscale", index: "3"},
    upscale4: {label:"U4", task_type:"upscale", index: "4"},
    upscale_creative: {label:"Upscale (Creative)", task_type:"upscale",index: "creative"},
    upscale_subtle: {label:"Upscale (Subtle)", task_type:"upscale",index: "subtle"},

    variation1: {label:"V1", task_type:"variation", index: "1"},
    variation2: {label:"V2", task_type:"variation", index: "2"},
    variation3: {label:"V3", task_type:"variation", index: "3"},
    variation4: {label:"V4", task_type:"variation", index: "4"},
    high_variation: {label:"Vary (Strong)", task_type:"variation",index: "high_variation"},
    low_variation: {label:"Vary (Subtle)", task_type:"variation",index: "low_variation"},

    "outpaint_1.5x": {label:"Zoom Out 1.5x", task_type:"outpaint",zoom_ratio:"1.5"},
    outpaint_2x: {label:"Zoom Out 2x", task_type:"outpaint",zoom_ratio:"2"},

    pan_down: {label:"⬇️", task_type:"pan",direction:"down"},
    pan_up: {label:"⬆️", task_type:"pan",direction:"up"},
    pan_left: {label:"⬅️", task_type:"pan",direction:"left"},
    pan_right: {label:"➡️", task_type:"pan",direction:"right"}

}

#monitoringDelay = 5000; // 5 seconds

constructor() {

};

async generateImage(prompt,timeout = 180000) {

    let taskResult;
    try{
        const task = await this.create_imagine(prompt,"fast",timeout);
        const startTime = Date.now();
        while (true){

            taskResult = await this.get_task_status(task.data.task_id,timeout);

            if (taskResult.data.status === "completed") {
                break
            } else if (taskResult.data.status === "failed") {
                throw new Error((taskResult.data?.error?.message + " " + taskResult.data?.error?.raw_message)|| "Error occurred during image generation.");
            }

            if(Date.now() - startTime > timeout){
                const canceleResult = await this.cancale_task(task.data.task_id,timeout)
                console.log("Task cancelled:", JSON.stringify(canceleResult));
                throw new Error(`Timeout ${timeout/1000} exceeded while waiting for image generation.`);
            }
            await otherFunctions.delay(this.#monitoringDelay)
        }
    } catch (error) {
        error.code = "MDJ_ERR";
        error.place_in_code = "PIAPI.generateImage";
        throw error;
    }

    const imageBuffer = await otherFunctions.getImageByUrl(taskResult.data.output.image_url)
   
    return {
            imageBuffer: imageBuffer,
            mdjMsg: { 
                id: taskResult.data.task_id,
                uri: taskResult.data.output.image_url,
                prompt:prompt,
                options:this.generateOptions(taskResult.data?.output?.actions)
            }
        }
    }

async executeButton(button_data,timeout = 180000){

    let taskResult;
    try {
        const task = await this.create_button_task(button_data,timeout);
        const startTime = Date.now();

        while (true){

            taskResult = await this.get_task_status(task.data.task_id,timeout);

            if (taskResult.data.status === "completed") {
                break
            } else if (taskResult.data.status === "failed") {
                throw new Error((taskResult.data?.error?.message + " " + taskResult.data?.error?.raw_message)|| "Error occurred during image generation.");
            }

            if(Date.now() - startTime > timeout){
                const canceleResult = await this.cancale_task(task.data.task_id,timeout)
                console.log("Task cancelled:", JSON.stringify(canceleResult));
                throw new Error(`Timeout ${timeout/1000} exceeded while waiting for image generation.`);
            }

            await otherFunctions.delay(this.#monitoringDelay)
        }
    } catch (error) {
        error.code = "MDJ_ERR";
        error.place_in_code = "PIAPI.executeButton";
        throw error;
    }

    const imageBuffer = await otherFunctions.getImageByUrl(taskResult.data.output.image_url)
   
    return {
            imageBuffer: imageBuffer,
            mdjMsg: { 
                id: taskResult.data.task_id,
                uri: taskResult.data.output.image_url,
                prompt:button_data.prompt,
                options:this.generateOptions(taskResult.data?.output?.actions)
            }
        }
    }




async create_button_task(button_data, timeout = 180000){

const inputSection = this.craftInputSection(button_data);


const config = {
    method: 'post',
    url: 'https://api.piapi.ai/api/v1/task',
    timeout: timeout,
    validateStatus: function (status) {
        return status >= 200 && status < 300 || status === 400 || status === 500
    },
    headers: {
            "Content-Type": "application",
            "x-api-key": process.env.PI_API_TOKEN
        },
    data : {
        model: "midjourney",
        task_type: button_data.task_type,
        input: inputSection,
        config:{
            service_mode:"public"
        }
    }
};

    const result = await axios(config);

    if (result.data.data.error.code > 0) {

        const error = new Error((result.data.data?.error?.message  + " " +  result.data.data?.error?.raw_message) || "Error occurred during image generation.");
        error.code = "MDJ_ERR";
        error.place_in_code = "PIAPI.create_button_task";
        error.details = result.data.data.error.detail;
        throw error;
    }

    return result.data

}

craftInputSection(button_data){

if(button_data.task_type === "reroll"){

    return {
       origin_task_id: button_data.id,
       prompt: button_data.prompt,
       skip_prompt_check: false
    }

} else if (button_data.task_type === "upscale") {

    return {
       origin_task_id: button_data.id,
       index: button_data.index,
    }

} else if (button_data.task_type === "variation") {

    return {
        origin_task_id: button_data.id,
        index: button_data.index,
        prompt: button_data.prompt,
        skip_prompt_check: false
    }
} else if (button_data.task_type === "pan") {

    return {
        origin_task_id: button_data.id,
        direction: button_data.direction,
        prompt: button_data.prompt,
        skip_prompt_check: false
    }
} else if (button_data.task_type === "outpaint") {

    return {
        origin_task_id: button_data.id,
        zoom_ratio: button_data.zoom_ratio,
        skip_prompt_check: false
    }
}
}

async create_imagine(prompt, process_mode="relax", timeout = 180000) {

    const config = {
        method: 'post',
        url: 'https://api.piapi.ai/api/v1/task',
        timeout:timeout,
        validateStatus: function (status) {
            return status >= 200 && status < 300 || status === 400 || status === 500
        },
        headers: {
                "Content-Type": "application",
                "x-api-key": process.env.PI_API_TOKEN
            },
        data : {
            model: "midjourney",
            task_type: "imagine",
            input: {
                prompt: prompt,
                process_mode: process_mode,
                skip_prompt_check: false
            },
            config:{
                service_mode:"public"
            }
            }
    };

    const result = await axios(config);

    if (result.data.data.error.code > 0) {
        const error = new Error((result.data.data?.error?.message  + " " +  result.data.data?.error?.raw_message) || "Error occurred during image generation.");
        error.code = "MDJ_ERR";
        error.place_in_code = "PIAPI.create_imagine";
        error.details = result.data.data.error.detail;
        throw error;
    }

    return result.data
}

async cancale_task(task_id, timeout = 180000) {

    const config = {
        method: 'delete',
        timeout:timeout,
        url: `https://api.piapi.ai/api/v1/task/${task_id}`,
        headers: {
                "Content-Type": "application",
                "x-api-key": process.env.PI_API_TOKEN
            }
    }

        const result = await axios(config);

    return result.data

}

async get_task_status(task_id, timeout = 180000) {

    const config = {
        method: 'get',
        timeout:timeout,
        url: `https://api.piapi.ai/api/v1/task/${task_id}`,
        headers: {
                "Content-Type": "application",
                "x-api-key": process.env.PI_API_TOKEN
            }
    }

    const result = await axios(config);

    return result.data
}

generateOptions(actions = []){
    return actions.map(action => {
        return {
            label: this.#actionslabelsMapping[action]?.label,
            task_type: this.#actionslabelsMapping[action]?.task_type,
            index: this.#actionslabelsMapping[action]?.index,
            zoom_ratio: this.#actionslabelsMapping[action]?.zoom_ratio,
            direction: this.#actionslabelsMapping[action]?.direction
        };
    })
    .filter(action => action.label);
}

}


module.exports = PIAPI;