using UnityEngine;

public class LightFlicker : MonoBehaviour
{
    public Light lightSource;
    public float minIntensity = 0.8f;
    public float maxIntensity = 1.2f;
    public float flickerSpeed = 0.1f;

    float timer;

    void Update()
    {
        timer += Time.deltaTime;

        if (timer > flickerSpeed)
        {
            lightSource.intensity = Random.Range(minIntensity, maxIntensity);
            timer = 0f;
        }
    }
}
