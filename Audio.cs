using UnityEngine;

public class RandomSound : MonoBehaviour
{
    public AudioSource source;
    public float minTime = 5f;
    public float maxTime = 20f;

    float timer;
    float nextTime;

    void Start()
    {
        SetNextTime();
    }

    void Update()
    {
        timer += Time.deltaTime;

        if (timer >= nextTime)
        {
            source.Play();
            timer = 0f;
            SetNextTime();
        }
    }

    void SetNextTime()
    {
        nextTime = Random.Range(minTime, maxTime);
    }
}
